import { randomBytes } from "node:crypto";











function escapeQuery(value) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function driveJson(
  token,
  url,
  fetchImpl,
  init,
) {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Drive isteği başarısız (${response.status}).`);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json().catch(() => null);
}

function firstId(payload) {
  if (!payload || typeof payload !== "object" || !("files" in payload) || !Array.isArray(payload.files)) {
    return null;
  }
  const first = payload.files[0];
  if (!first || typeof first !== "object" || !("id" in first) || typeof first.id !== "string") {
    return null;
  }
  return first.id;
}

export function createDriveApi(token, fetchImpl = fetch) {
  async function findChild(name, parentId, folder) {
    const parent = parentId ? `'${escapeQuery(parentId)}' in parents` : "'root' in parents";
    const mime = folder
      ? " and mimeType = 'application/vnd.google-apps.folder'"
      : " and mimeType != 'application/vnd.google-apps.folder'";
    const q = `name = '${escapeQuery(name)}' and trashed = false and ${parent}${mime}`;
    const params = new URLSearchParams({
      q,
      fields: "files(id)",
      pageSize: "1",
      spaces: "drive",
    });
    const payload = await driveJson(
      token,
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      fetchImpl,
    );
    return firstId(payload);
  }

  return {
    findChildFolder(name, parentId) {
      return findChild(name, parentId, true);
    },
    async createFolder(name, parentId) {
      const payload = await driveJson(token, "https://www.googleapis.com/drive/v3/files?fields=id", fetchImpl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          mimeType: "application/vnd.google-apps.folder",
          parents: parentId ? [parentId] : undefined,
        }),
      });
      if (!payload || typeof payload !== "object" || !("id" in payload) || typeof payload.id !== "string") {
        throw new Error("Drive klasörü oluşturulamadı.");
      }
      return payload.id;
    },
    findChildFile(name, parentId) {
      return findChild(name, parentId, false);
    },
    async uploadPdf(name, parentId, bytes) {
      const boundary = `flywork${randomBytes(8).toString("hex")}`;
      const meta = JSON.stringify({
        name,
        parents: [parentId],
        mimeType: "application/pdf",
      });
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--`),
      ]);
      const payload = await driveJson(
        token,
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
        fetchImpl,
        {
          method: "POST",
          headers: { "content-type": `multipart/related; boundary=${boundary}` },
          body,
        },
      );
      if (!payload || typeof payload !== "object" || !("id" in payload) || typeof payload.id !== "string") {
        throw new Error("Drive dosyası yüklenemedi.");
      }
      return payload.id;
    },
  };
}

export async function ensureDriveFolder(db, drive, folder) {
  const parts = folder.split("/").filter(Boolean);
  let parentId = null;
  let folderPath = "";
  for (const name of parts) {
    folderPath = folderPath ? `${folderPath}/${name}` : name;
    const cached = await db.driveFolder.findUnique({ where: { path: folderPath } });
    if (cached) {
      parentId = cached.driveId;
      continue;
    }
    const existing = await drive.findChildFolder(name, parentId);
    const driveId = existing ?? (await drive.createFolder(name, parentId));
    await db.driveFolder.upsert({
      where: { path: folderPath },
      update: { driveId },
      create: { path: folderPath, driveId },
    });
    parentId = driveId;
  }
  if (!parentId) {
    throw new Error("Drive klasör yolu boş.");
  }
  return parentId;
}
