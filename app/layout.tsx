import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "光学方案计算器 · 宁波5号线360检测",
  description: "基于方案文档与 SICK Ranger3 计算口径的 2D / 3D 光学方案计算器。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
