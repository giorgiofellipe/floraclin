import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FloraClin",
    short_name: "FloraClin",
    description: "Gestão clínica para Harmonização Orofacial",
    start_url: "/",
    display: "standalone",
    background_color: "#FAF7F3",
    theme_color: "#1C2B1E",
    icons: [
      { src: "/brand/logo-symbol.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
