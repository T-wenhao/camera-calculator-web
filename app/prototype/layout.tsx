import type { Metadata } from "next";
import "./prototype.css";

export const metadata: Metadata = {
  title: "光学方案计算器 · 界面原型",
  description: "用于验证信息架构与桌面端操作流程的可抛弃原型。",
};

export default function PrototypeLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
