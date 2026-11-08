"use client";

import { ConversationProvider } from "@elevenlabs/react";
import Stage from "@/components/Stage";

export default function Home() {
  return (
    <ConversationProvider>
      <Stage />
    </ConversationProvider>
  );
}
