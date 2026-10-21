import type { Metadata } from "next";

import { SaffronLanding } from "@/components/saffron/saffron-landing";

export const metadata: Metadata = {
  title: "SaffronAI",
  description: "Hire and train AI employees. Plug-and-play infrastructure for AI-native websites.",
};

/** Always shows the marketing site (preview before saffronai.in DNS is moved). */
export default function SaffronPreviewPage() {
  return <SaffronLanding />;
}
