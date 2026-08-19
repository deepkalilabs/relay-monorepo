import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { WorkflowSchema } from "../dist/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(packageRoot, "schema/workflow-1.5.schema.json");
const schema = z.toJSONSchema(WorkflowSchema, {
  target: "draft-2020-12",
  reused: "ref",
});

const replayableLocatorConstraint = {
  anyOf: [
    { required: ["selector"] },
    { required: ["role"] },
    { required: ["name"] },
    { required: ["text"] },
    {
      required: ["candidates"],
      properties: { candidates: { type: "array", minItems: 1 } },
    },
  ],
};

function replayableTarget(targetSchema) {
  return { allOf: [targetSchema, replayableLocatorConstraint] };
}

for (const stepSchema of schema.properties.steps.items.oneOf) {
  const typeSchema = stepSchema.properties.type;
  const stepType = typeSchema.const
    ?? schema.$defs[typeSchema.$ref?.replace("#/$defs/", "")]?.const;
  if (["click", "fill", "set_date", "select", "check", "uncheck", "keypress", "submit"].includes(stepType)) {
    stepSchema.properties.target = replayableTarget(stepSchema.properties.target);
  }
  if (stepType === "assertion") {
    const targetSchema = stepSchema.properties.target;
    stepSchema.allOf = [{
      if: {
        required: ["expectation"],
        properties: {
          expectation: {
            required: ["kind"],
            properties: { kind: { const: "page_text_contains" } },
          },
        },
      },
      then: {
        not: {
          anyOf: [
            { required: ["target"] },
            { required: ["groupTarget"] },
            { required: ["position"] },
          ],
        },
      },
      else: {
        if: {
          required: ["expectation"],
          properties: {
            expectation: {
              required: ["kind"],
              properties: { kind: { const: "group_exists" } },
            },
          },
        },
        then: { required: ["groupTarget"], not: { required: ["target"] } },
        else: {
          required: ["target"],
          not: { required: ["groupTarget"] },
          properties: { target: replayableTarget(targetSchema) },
        },
      },
    }];
  }
}

function alignRefinementConstraints(value) {
  if (!value || typeof value !== "object") return;
  if (value.properties?.state && value.properties?.target) {
    value.properties.target = replayableTarget(value.properties.target);
  }
  if (value.properties?.delayMs && value.properties?.condition) {
    value.anyOf = [
      { required: ["condition"] },
      { required: ["delayMs"], properties: { delayMs: { minimum: 1 } } },
    ];
  }
  for (const child of Object.values(value)) alignRefinementConstraints(child);
}

alignRefinementConstraints(schema);
schema.$id = "https://relay.local/schemas/workflow-1.5.schema.json";
schema.title = "Relay Workflow 1.5";
const rendered = `${JSON.stringify(schema, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== rendered) {
    process.stderr.write("workflow-1.5.schema.json is out of date; run npm run schema:generate.\n");
    process.exitCode = 1;
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, rendered, "utf8");
}
