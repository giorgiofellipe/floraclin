import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "FloraClin — Gestão para clínicas de HOF";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const fontsDir = join(process.cwd(), "src/app/fonts");
  const [cormorant, dmSans] = await Promise.all([
    readFile(join(fontsDir, "cormorant-garamond-500.ttf")),
    readFile(join(fontsDir, "dm-sans-400.ttf")),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background:
            "linear-gradient(145deg, #1C2B1E 0%, #273a2a 40%, #4A6B52 100%)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Decorative circles */}
        <div
          style={{
            position: "absolute",
            top: -100,
            right: -100,
            width: 450,
            height: 450,
            borderRadius: "50%",
            border: "1px solid rgba(143, 180, 154, 0.12)",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -150,
            left: -80,
            width: 520,
            height: 520,
            borderRadius: "50%",
            border: "1px solid rgba(143, 180, 154, 0.08)",
            display: "flex",
          }}
        />

        {/* Logo + brand name */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginBottom: 40,
          }}
        >
          <svg width="132" height="132" viewBox="0 0 52 52" fill="none">
            <ellipse cx="26" cy="16" rx="6" ry="12" stroke="rgba(250,247,243,0.85)" strokeWidth="1.2" transform="rotate(0 26 26)" />
            <ellipse cx="26" cy="16" rx="6" ry="12" stroke="rgba(250,247,243,0.85)" strokeWidth="1.2" transform="rotate(60 26 26)" />
            <ellipse cx="26" cy="16" rx="6" ry="12" stroke="rgba(250,247,243,0.85)" strokeWidth="1.2" transform="rotate(120 26 26)" />
            <ellipse cx="26" cy="16" rx="6" ry="12" stroke="rgba(250,247,243,0.85)" strokeWidth="1.2" transform="rotate(180 26 26)" />
            <ellipse cx="26" cy="16" rx="6" ry="12" stroke="rgba(250,247,243,0.85)" strokeWidth="1.2" transform="rotate(240 26 26)" />
            <ellipse cx="26" cy="16" rx="6" ry="12" stroke="rgba(250,247,243,0.85)" strokeWidth="1.2" transform="rotate(300 26 26)" />
            <circle cx="26" cy="26" r="3" fill="rgba(250,247,243,0.85)" />
          </svg>
          <span
            style={{
              fontFamily: "Cormorant Garamond",
              fontSize: 114,
              fontWeight: 500,
              color: "#FAF7F3",
              letterSpacing: "-0.02em",
            }}
          >
            FloraClin
          </span>
        </div>

        {/* Main heading */}
        <h1
          style={{
            fontFamily: "Cormorant Garamond",
            fontSize: 56,
            fontWeight: 500,
            color: "#FAF7F3",
            letterSpacing: "-0.02em",
            lineHeight: 1.15,
            margin: 0,
            textAlign: "center",
            maxWidth: 850,
          }}
        >
          A gestão clínica que seus resultados merecem.
        </h1>

        {/* Subtitle */}
        <p
          style={{
            fontFamily: "DM Sans",
            fontSize: 20,
            color: "rgba(250, 247, 243, 0.55)",
            marginTop: 24,
            letterSpacing: "0.04em",
          }}
        >
          Agenda · Prontuário · Diagrama Facial · Financeiro
        </p>

        {/* Bottom domain */}
        <div
          style={{
            position: "absolute",
            bottom: 36,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 28,
              height: 1,
              backgroundColor: "rgba(250, 247, 243, 0.2)",
              display: "flex",
            }}
          />
          <span
            style={{
              fontFamily: "DM Sans",
              fontSize: 13,
              color: "rgba(250, 247, 243, 0.35)",
              textTransform: "uppercase" as const,
              letterSpacing: "0.18em",
            }}
          >
            floraclin.com.br
          </span>
          <div
            style={{
              width: 28,
              height: 1,
              backgroundColor: "rgba(250, 247, 243, 0.2)",
              display: "flex",
            }}
          />
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Cormorant Garamond",
          data: cormorant,
          weight: 500,
          style: "normal",
        },
        {
          name: "DM Sans",
          data: dmSans,
          weight: 400,
          style: "normal",
        },
      ],
    }
  );
}
