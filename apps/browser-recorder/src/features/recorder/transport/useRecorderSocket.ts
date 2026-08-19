"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SequencedServerMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from "@/shared/contracts/protocol";
import type { TransportStatus } from "../model/recorder.types";

export type { TransportStatus } from "../model/recorder.types";

export function useRecorderSocket(onMessage: (message: ServerMessage) => void) {
  const [transportStatus, setTransportStatus] = useState<TransportStatus>("connecting");
  const socketRef = useRef<WebSocket | null>(null);
  const [clientId] = useState(() => crypto.randomUUID());
  const sequenceRef = useRef(0);
  const callbackRef = useRef(onMessage);
  const reconnectAttemptRef = useRef(0);
  const disposedRef = useRef(false);

  useEffect(() => {
    callbackRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    disposedRef.current = false;
    const delays = [500, 1_000, 2_000, 4_000];
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (disposedRef.current) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/ws`);
      socketRef.current = socket;
      setTransportStatus(reconnectAttemptRef.current ? "reconnecting" : "connecting");

      socket.addEventListener("open", () => {
        reconnectAttemptRef.current = 0;
        setTransportStatus("connected");
        socket.send(
          JSON.stringify({
            type: "client.hello",
            clientId,
            lastSequence: sequenceRef.current,
          } satisfies ClientMessage),
        );
      });

      socket.addEventListener("message", (event) => {
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(String(event.data));
        } catch {
          return;
        }
        const parsed = SequencedServerMessageSchema.safeParse(parsedJson);
        if (!parsed.success) return;
        if (parsed.data.sequence > 0) sequenceRef.current = Math.max(sequenceRef.current, parsed.data.sequence);
        callbackRef.current(parsed.data.message);
      });

      socket.addEventListener("close", () => {
        if (disposedRef.current) return;
        const attempt = reconnectAttemptRef.current++;
        if (attempt >= delays.length) {
          setTransportStatus("offline");
          return;
        }
        setTransportStatus("reconnecting");
        reconnectTimer = setTimeout(connect, delays[attempt]);
      });

      socket.addEventListener("error", () => socket.close());
    };

    connect();
    return () => {
      disposedRef.current = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, [clientId]);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  return { transportStatus, send };
}
