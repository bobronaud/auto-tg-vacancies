import { basename } from "node:path";
import nodemailer from "nodemailer";
import type { Config } from "../config/schema.js";

export function emailConfigProblem(config: Config): string | null {
  const e = config.apply.email;
  if (!e.from || !e.smtpHost) return "заполните apply.email.from и apply.email.smtpHost в config.yaml";
  if (!process.env.SMTP_PASSWORD) return "добавьте SMTP_PASSWORD в .env (для Gmail — пароль приложения)";
  return null;
}

export function emailSubject(config: Config, v: { title: string; company: string | null }): string {
  return config.apply.email.subject.replaceAll("{title}", v.title).replaceAll("{company}", v.company ?? "");
}

export async function sendEmail(
  config: Config,
  msg: { to: string; subject: string; text: string; pdf: string | null },
): Promise<string> {
  const problem = emailConfigProblem(config);
  if (problem) throw new Error(problem);
  const e = config.apply.email;
  const transport = nodemailer.createTransport({
    host: e.smtpHost,
    port: e.smtpPort,
    secure: e.smtpPort === 465,
    auth: { user: e.user || e.from, pass: process.env.SMTP_PASSWORD },
  });
  const info = await transport.sendMail({
    from: e.from,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    attachments: msg.pdf ? [{ filename: basename(msg.pdf), path: msg.pdf }] : [],
  });
  return `message-id ${info.messageId}`;
}
