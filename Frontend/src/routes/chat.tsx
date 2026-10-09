import { createFileRoute } from "@tanstack/react-router";
import { ChatPage } from "@/components/chat/ChatPage";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Study Chat — OmniPrep.ai" },
      { name: "description", content: "Ask questions about your uploaded PDFs and notes and get cited answers." },
      { property: "og:title", content: "Study Chat — OmniPrep.ai" },
      { property: "og:description", content: "Chat with your documents and discover related study resources." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChatPage,
});
