import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { loadEnvConfig } from "@next/env";
import { WebSocketServer, type WebSocket } from "ws";
import { ClientMessageSchema } from "./src/shared/contracts/protocol";
import { BrowserbaseProvider } from "./src/server/infrastructure/browser/browserbase";
import { createWorkflowRepositoryResolver } from "./src/server/infrastructure/storage/repository-factory";
import {
  createAutomationBatchService,
  handleAutomationBatchApi,
} from "./src/server/automation/http-router";
import { RecordingRuntime } from "./src/server/recording/runtime";
import { handleProfileApi } from "./src/server/profiles/http-router";
import { FileProfileRepository } from "./src/server/profiles/filesystem-repository";
import { handleWorkspaceApi } from "./src/server/workspaces/http-router";
import { handleWorkflowApi } from "./src/server/workflows/http-router";

loadEnvConfig(process.cwd());

async function main() {
const dev = process.env.NODE_ENV !== "production";
const hostname = dev ? "127.0.0.1" : "0.0.0.0";
const port = Number(process.env.PORT || 3000);
let requestHandler: ((req: Parameters<typeof createServer>[0] extends never ? never : never) => void) | null = null;
const profileRepository = new FileProfileRepository();
const workflowResolver = createWorkflowRepositoryResolver(process.env, { development: dev });
const automationBatchClient = createAutomationBatchService();

const server = createServer(async (req, res) => {
  if (await handleWorkspaceApi(req, res, workflowResolver)) return;
  if (await handleAutomationBatchApi(req, res, workflowResolver, automationBatchClient)) return;
  if (await handleProfileApi(req, res, profileRepository)) return;
  if (await handleWorkflowApi(req, res, workflowResolver)) return;
  if (!requestHandler) {
    res.statusCode = 503;
    res.end("Starting…");
    return;
  }
  const parsedUrl = parse(req.url || "/", true);
  (requestHandler as unknown as (request: typeof req, response: typeof res, parsed: typeof parsedUrl) => void)(req, res, parsedUrl);
});

const app = next({ dev, hostname, port, httpServer: server });
await app.prepare();
requestHandler = app.getRequestHandler() as never;

const webSockets = new WebSocketServer({ noServer: true, maxPayload: 2_097_152 });
const runtimes = new Map<string, RecordingRuntime>();
const apiKey = process.env.BROWSERBASE_API_KEY;
const provider = apiKey ? new BrowserbaseProvider(apiKey, process.env.BROWSERBASE_PROJECT_ID) : null;
const allowedRegions = ["us-west-2", "us-east-1", "eu-central-1", "ap-southeast-1"] as const;
const requestedRegion = process.env.BROWSERBASE_REGION;
const region = allowedRegions.find((candidate) => candidate === requestedRegion) ?? "us-west-2";
const timeoutSeconds = Math.min(21_600, Math.max(60, Number(process.env.BROWSERBASE_SESSION_TIMEOUT_SECONDS || 1800)));

server.prependListener("upgrade", (request, socket, head) => {
  if (parse(request.url || "").pathname !== "/ws") return;
  webSockets.handleUpgrade(request, socket, head, (ws) => webSockets.emit("connection", ws, request));
});

webSockets.on("connection", (socket: WebSocket) => {
  let runtime: RecordingRuntime | null = null;

  const sendUnsequencedError = (message: string) => {
    socket.send(JSON.stringify({ sequence: 0, message: { type: "server.error", code: "INVALID_MESSAGE", message, recoverable: true } }));
  };

  socket.on("message", async (data) => {
    let json: unknown;
    try {
      json = JSON.parse(data.toString());
    } catch {
      sendUnsequencedError("Messages must be valid JSON.");
      return;
    }
    const parsed = ClientMessageSchema.safeParse(json);
    if (!parsed.success) {
      const commandType = typeof json === "object" && json !== null && "type" in json && typeof json.type === "string"
        ? ` ${json.type}`
        : "";
      sendUnsequencedError(`The recorder received an invalid${commandType} command. Refresh the app and try again.`);
      return;
    }

    try {
      const message = parsed.data;
      if (message.type === "client.hello") {
        runtime = runtimes.get(message.clientId) ?? null;
        if (!runtime) {
          if (!provider) {
            socket.send(JSON.stringify({ sequence: 0, message: { type: "server.ready", configured: false } }));
            return;
          }
          runtime = new RecordingRuntime(message.clientId, provider, () => runtimes.delete(message.clientId));
          runtimes.set(message.clientId, runtime);
        }
        runtime.attach(socket, message.lastSequence);
        runtime.emit({ type: "server.ready", configured: true });
      } else if (!runtime) {
        sendUnsequencedError("Send client.hello before recorder commands.");
      } else if (message.type === "session.start") {
        await runtime.setNativeSelects(message.nativeSelects);
        await runtime.start({ timeoutSeconds, region });
      } else if (message.type === "session.restart") {
        const clientId = runtime.clientId;
        await runtime.release();
        const nextSequence = runtime.sequence;
        runtime = new RecordingRuntime(clientId, provider!, () => runtimes.delete(clientId), nextSequence);
        runtimes.set(clientId, runtime);
        runtime.attach(socket, nextSequence);
        runtime.emit({ type: "server.ready", configured: true });
        await runtime.setNativeSelects(message.nativeSelects);
        await runtime.start({ timeoutSeconds, region });
      } else if (message.type === "session.stop") {
        const clientId = runtime.clientId;
        await runtime.release();
        const nextSequence = runtime.sequence;
        runtime = new RecordingRuntime(clientId, provider!, () => runtimes.delete(clientId), nextSequence);
        runtimes.set(clientId, runtime);
        runtime.attach(socket, nextSequence);
        runtime.emit({ type: "server.ready", configured: true });
      } else if (message.type === "popup.switch") {
        await runtime.switchPage(message.pageId);
      } else if (message.type === "browser.navigate") {
        await runtime.navigate(message.url);
      } else if (message.type === "browser.back") {
        await runtime.goBack();
      } else if (message.type === "browser.forward") {
        await runtime.goForward();
      } else if (message.type === "browser.reload") {
        await runtime.reload();
      } else if (message.type === "date.picker.select") {
        await runtime.selectDate(message.requestId, message.value);
      } else if (message.type === "date.picker.dismiss") {
        runtime.dismissDatePicker(message.requestId);
      } else if (message.type === "select.picker.select") {
        await runtime.selectPickerOption(message.requestId, message.value);
      } else if (message.type === "select.picker.dismiss") {
        runtime.dismissSelectPicker(message.requestId);
      } else if (message.type === "select.native.set") {
        await runtime.setNativeSelects(message.enabled);
      } else if (message.type === "assertion.pick.start") {
        await runtime.startAssertionPick(message.requestId);
      } else if (message.type === "assertion.pick.cancel") {
        runtime.cancelAssertionPick(message.requestId);
      } else if (message.type === "captcha.continue") {
        runtime.continueAfterCaptcha(message.pageId);
      } else if (message.type === "replay.start") {
        await runtime.setNativeSelects(message.nativeSelects);
        await runtime.startReplay(message.workflow, message.startStepId, { timeoutSeconds, region });
      } else if (message.type === "replay.pause") {
        runtime.pauseReplay();
      } else if (message.type === "replay.resume") {
        runtime.resumeReplay();
      } else if (message.type === "replay.retry") {
        runtime.retryReplay();
      } else if (message.type === "replay.skip") {
        runtime.skipReplay();
      } else if (message.type === "replay.takeControl") {
        runtime.takeControlOfReplay();
      } else if (message.type === "replay.stop") {
        await runtime.stopReplay();
      }
    } catch (error) {
      runtime?.emit({
        type: "server.error",
        code: "RUNTIME_ERROR",
        message: error instanceof Error ? error.message : "The recorder could not complete that action.",
        recoverable: true,
      });
    }
  });

  socket.on("close", () => runtime?.detach());
});

async function shutdown() {
  await Promise.all([...runtimes.values()].map((runtime) => runtime.release()));
  webSockets.close();
  server.close(() => process.exit(0));
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

server.listen(port, hostname, () => {
  console.log(`Browser Memory Recorder ready at http://${hostname}:${port}`);
});
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "The server failed to start.");
  process.exit(1);
});
