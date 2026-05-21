'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import io from 'socket.io-client';

let socket: any = null;

export function useSocket() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!socket) {
      const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3000';
      socket = io(wsUrl, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10
      });

      socket.on('connect', () => {
        setConnected(true);
      });

      socket.on('disconnect', () => {
        setConnected(false);
      });
    }

    return () => {
    };
  }, []);

  return { socket, connected };
}

export function getSocket() {
  return socket;
}

export function emit(event: string, data: any) {
  if (socket?.connected) {
    socket.emit(event, data);
  }
}

export function on(event: string, callback: (data: any) => void) {
  if (socket) {
    socket.on(event, callback);
  }
}

export function off(event: string, callback?: (data: any) => void) {
  if (socket) {
    if (callback) {
      socket.off(event, callback);
    } else {
      socket.off(event);
    }
  }
}