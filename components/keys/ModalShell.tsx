"use client";

import React from "react";
import { Modal } from "@/components/ui/dialog";

interface ModalShellProps {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}

/**
 * Thin alias over the app Modal (components/ui/dialog.tsx) — kept so the
 * keys call sites didn't have to change. New code should import Modal
 * directly.
 */
export function ModalShell(props: ModalShellProps) {
  return <Modal {...props} />;
}
