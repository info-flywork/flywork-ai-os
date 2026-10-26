import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "../src/generated/prisma/client";
import { createMysqlAdapter } from "../src/server/mysql";
import { sealSessionToken } from "../src/server/auth/cookieSeal";
import { createSessionToken, hashSessionToken } from "../src/server/auth/token";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient({
  adapter: createMysqlAdapter(),
});
const hashes: string[] = [];
const profile = mkdtempSync(`${tmpdir()}/fw-staff-`);
const port = 9432;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openSession(name: string) {
  const user = await prisma.user.findFirst({
    where: { name, active: true },
    select: { id: true, role: true, mealOnly: true },
  });
  if (!user) throw new Error(`${name} yok`);
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const tokenHash = hashSessionToken(token);
  hashes.push(tokenHash);
  await prisma.session.create({ data: { userId: user.id, tokenHash, expiresAt } });
  return { ...user, sealed: await sealSessionToken(token, expiresAt) };
}

async function look(sealed: string, path: string, cookieName?: "flywork_staff" | "flywork_meal") {
  const response = await fetch(`http://localhost:3010${path}`, {
    headers: { cookie: `flywork_session=${sealed}${cookieName ? `; ${cookieName}=1` : ""}` },
    redirect: "manual",
  });
  const html = response.status === 200 ? await response.text() : "";
  return {
    path,
    status: response.status,
    location: response.headers.get("location"),
    links: [...html.matchAll(/href="(\/(?:yemek-yonetimi|izin|harcama|otomasyon|teknoloji|kullanicilar|bildirimler|flywork-giderleri))"/g)].map((match) => match[1]),
    order: html.includes("Ana yemekler"),
    today: html.includes("Bugünkü siparişler"),
    month: html.includes("Tüm aylar"),
    leave: html.includes("İzin Talebi"),
  };
}

async function browse(sealed: string) {
  const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-gpu",
    "about:blank",
  ], { stdio: "ignore" });
  let version: { webSocketDebuggerUrl: string } | null = null;
  for (let attempt = 0; attempt < 30 && !version; attempt += 1) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch {
      await wait(200);
    }
  }
  if (!version) throw new Error("tarayıcı açılmadı");
  const browser = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    browser.addEventListener("open", resolve);
    browser.addEventListener("error", reject);
  });
  let nextId = 1;
  const pending = new Map<number, (value: unknown) => void>();
  browser.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown };
    if (message.id && pending.has(message.id)) pending.get(message.id)?.(message.result);
  });
  const send = (method: string, params: Record<string, unknown> = {}) => {
    const id = nextId;
    nextId += 1;
    browser.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => pending.set(id, resolve));
  };
  const created = await send("Target.createTarget", { url: "about:blank" }) as { targetId: string };
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { id: string; webSocketDebuggerUrl: string }[];
  const pageUrl = targets.find((target) => target.id === created.targetId)?.webSocketDebuggerUrl;
  if (!pageUrl) throw new Error("sayfa yok");
  const page = new WebSocket(pageUrl);
  await new Promise((resolve) => page.addEventListener("open", resolve));
  const pagePending = new Map<number, (value: unknown) => void>();
  page.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown };
    if (message.id && pagePending.has(message.id)) pagePending.get(message.id)?.(message.result);
  });
  let pageId = 1;
  const call = (method: string, params: Record<string, unknown> = {}) => {
    const id = pageId;
    pageId += 1;
    page.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => pagePending.set(id, resolve));
  };
  await call("Network.enable");
  await call("Page.enable");
  await call("Network.setCookie", { name: "flywork_session", value: sealed, url: "http://localhost:3010" });
  await call("Network.setCookie", { name: "flywork_staff", value: "1", url: "http://localhost:3010" });
  async function read(url: string) {
    await call("Page.navigate", { url });
    await wait(2200);
    const result = await call("Runtime.evaluate", {
      expression: `JSON.stringify({href:location.href, links:[...document.querySelectorAll("nav a")].map(a=>a.textContent.trim()), order:document.body.innerText.includes("Ana yemekler"), today:document.body.innerText.includes("Bugünkü siparişler"), month:document.body.innerText.includes("Tüm aylar"), leave:document.body.innerText.includes("İzin Talebi"), home:document.body.innerText.includes("Çalışma alanı")})`,
      returnByValue: true,
    }) as { result: { value: string } };
    return JSON.parse(result.result.value) as Record<string, unknown>;
  }
  const order = await read("http://localhost:3010/yemek-yonetimi?sekme=aylik");
  const leave = await read("http://localhost:3010/izin");
  const blocked = await read("http://localhost:3010/harcama");
  browser.close();
  page.close();
  chrome.kill("SIGKILL");
  return { order, leave, blocked };
}

async function main() {
  const names = ["Emrah Doğan", "Furkan Kazım Çam", "Sena Özyiğit", "Berivan Yalçın", "Tunahan Avşar"];
  const users = await prisma.user.findMany({
    where: { name: { in: names } },
    select: { name: true, role: true, mealOnly: true, active: true },
    orderBy: { name: "asc" },
  });
  const emrah = await openSession("Emrah Doğan");
  const berivan = await openSession("Berivan Yalçın");
  const admin = await openSession("Tunahan Avşar");
  const staffPaths = ["/", "/yemek-yonetimi", "/yemek-yonetimi?sekme=aylik", "/izin", "/harcama", "/otomasyon", "/teknoloji"];
  const staff = [];
  for (const path of staffPaths) staff.push(await look(emrah.sealed, path, "flywork_staff"));
  const mealLeave = await look(berivan.sealed, "/izin", "flywork_meal");
  const adminHome = await look(admin.sealed, "/");
  const browser = await browse(emrah.sealed);
  console.log(JSON.stringify({ users, staff, mealLeave: { status: mealLeave.status, location: mealLeave.location }, adminStatus: adminHome.status, browser }, null, 2));
}

try {
  await main();
} finally {
  if (hashes.length > 0) await prisma.session.deleteMany({ where: { tokenHash: { in: hashes } } });
  await prisma.$disconnect();
  rmSync(profile, { recursive: true, force: true });
}
