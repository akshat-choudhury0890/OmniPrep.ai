import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "@/components/landing/LandingPage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "OmniPrep.ai — Turn your notes into answers" },
      { name: "description", content: "AI study companion: upload PDFs and notes, ask questions, get grounded answers with citations." },
      { property: "og:title", content: "OmniPrep.ai — Turn your notes into answers" },
      { property: "og:description", content: "Upload your notes and get AI answers grounded in your own material." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LandingPage,
});
