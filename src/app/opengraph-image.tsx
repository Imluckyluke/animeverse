import { ImageResponse } from "next/og";
import { VAZIRMATN_BOLD_BASE64 } from "@/lib/og-font";

export const runtime = "nodejs";
export const alt = "انیمه‌ورس — آرشیو انیمه با زیرنویس فارسی";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function fontData(): Uint8Array {
  const binary = atob(VAZIRMATN_BOLD_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Site-wide social card (Telegram, X, WhatsApp, …). */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          padding: "72px 80px",
          backgroundColor: "#060609",
          color: "#ffffff",
          fontFamily: "Vazirmatn",
        }}
      >
        {/* Amber wash in the corner, drawn with a supported linear-gradient. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 620,
            height: 630,
            backgroundImage: "linear-gradient(215deg, rgba(255,214,10,0.26), rgba(6,6,9,0))",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: 520,
            height: 380,
            backgroundImage: "linear-gradient(35deg, rgba(124,107,255,0.22), rgba(6,6,9,0))",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 18, position: "relative" }}>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 18,
              backgroundImage: "linear-gradient(140deg, #ffd60a, #ff9f43)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#1a1206",
              fontSize: 34,
              fontWeight: 700,
            }}
          >
            AV
          </div>
          <div style={{ fontSize: 22, color: "rgba(255,255,255,0.62)", letterSpacing: 3 }}>
            ANIMEVERSE
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            marginTop: "auto",
            marginBottom: "auto",
            position: "relative",
          }}
        >
          <div style={{ fontSize: 104, fontWeight: 700, lineHeight: 1.15 }}>انیمه‌ورس</div>
          <div style={{ fontSize: 36, color: "rgba(255,255,255,0.76)", lineHeight: 1.5 }}>
            آرشیوی از انیمه‌ها با زیرنویس فارسی و کیفیت ۱۰۸۰p
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid rgba(255,255,255,0.14)",
            paddingTop: 26,
            fontSize: 24,
            color: "rgba(255,255,255,0.55)",
            position: "relative",
          }}
        >
          <div>سریال، فیلم و انیمه‌های چینی</div>
          <div style={{ color: "#ffd60a", fontWeight: 700 }}>دانلود سریع</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Vazirmatn", data: fontData(), weight: 700, style: "normal" }],
    },
  );
}
