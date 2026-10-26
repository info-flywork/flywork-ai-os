import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCatalogSource } from "@/server/meals/catalogSource";
import type { CatalogImportState } from "@/app/(panel)/yemek-yonetimi/actions";
import type { CatalogPreview } from "@/server/meals/importCatalog";

vi.mock("@/app/(panel)/yemek-yonetimi/actions", () => ({
  importCatalogAction: vi.fn(),
}));

import { importCatalogAction } from "@/app/(panel)/yemek-yonetimi/actions";
import CatalogImport from "@/components/meals/CatalogImport";

const action = vi.mocked(importCatalogAction);

function chooseFile(input: HTMLInputElement, file: File | null) {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: file ? [file] : [],
  });
  fireEvent.change(input);
}

function previewFor(source: CatalogPreview["source"]): CatalogPreview {
  return {
    source,
    rows: [
      {
        line: 2,
        name: "Faz3 Kart",
        outcome: "create",
        missingPhoto: true,
        message: "Yeni kayıt. Fotoğraf yok.",
        categoryLabel: "Tatlılar",
        slotLabel: "Tatlı",
        priceLabel: "",
        description: "",
      },
    ],
    created: 118,
    skipped: 0,
    failed: 0,
    missingPhotos: 118,
    photosAttached: 0,
  };
}

describe("katalog aktarım ekranı", () => {
  afterEach(() => {
    cleanup();
    action.mockReset();
  });

  it("dosya ve güncel önizleme olmadan onayı kapalı tutar", async () => {
    action.mockImplementation(async (_previous, formData) => {
      const file = formData.get("dosya");
      if (!(file instanceof File)) {
        return { ok: false, message: "Katalog dosyası seçin." };
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const preview = previewFor(buildCatalogSource({ name: file.name, text: "", bytes }, []));
      const state: CatalogImportState = {
        ok: true,
        message: "Önizleme hazır. Kayıt yazılmadı.",
        preview,
        committed: false,
      };
      return state;
    });

    render(<CatalogImport />);
    const approve = screen.getByRole("button", { name: "İçe aktarmayı onayla" });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Katalog dosyası seçilmedi.")).toBeTruthy();

    const input = screen.getByLabelText("Katalog dosyası") as HTMLInputElement;
    const file = new File(["ad,kategori\n"], "liste.csv", { type: "text/csv" });
    chooseFile(input, file);
    expect(screen.getByText("Seçilen dosya: liste.csv")).toBeTruthy();
    expect((approve as HTMLButtonElement).disabled).toBe(true);

    fireEvent.submit(input.form!);
    expect(await screen.findByText("Önizleme seçilen dosyaya ait: liste.csv. Kayıt yazılmadı.")).toBeTruthy();
    const listed = screen.getAllByText(/Faz3 Kart/);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed[0]?.textContent).toMatch(/Kategori: Tatlılar/);
    expect(listed[0]?.textContent).toMatch(/Grup: Tatlı/);
    expect(screen.getByText("Yeni kayıt").parentElement?.querySelector("dd")?.textContent).toBe("118");
    expect(screen.getByText("Eşleşen").parentElement?.querySelector("dd")?.textContent).toBe("0");
    expect(screen.getByText("Hatalı").parentElement?.querySelector("dd")?.textContent).toBe("0");
    expect(screen.getByText("Eksik fotoğraf").parentElement?.querySelector("dd")?.textContent).toBe("118");
    await waitFor(() => expect((approve as HTMLButtonElement).disabled).toBe(false));
    expect(input.files?.[0]?.name).toBe("liste.csv");

    const submitted = action.mock.calls.at(-1)?.[1];
    expect(submitted?.get("onay")).toBeNull();
    expect((submitted?.get("dosya") as File).name).toBe("liste.csv");

    chooseFile(input, new File(["baska"], "diger.csv", { type: "text/csv" }));
    expect(screen.queryAllByText(/Faz3 Kart/).length).toBe(0);
    expect(screen.getByText("Seçilen dosya: diger.csv")).toBeTruthy();
    expect((approve as HTMLButtonElement).disabled).toBe(true);

    chooseFile(input, file);
    fireEvent.submit(input.form!);
    await waitFor(() => expect((approve as HTMLButtonElement).disabled).toBe(false));
    chooseFile(input, null);
    expect(screen.getByText("Katalog dosyası seçilmedi.")).toBeTruthy();
    expect(screen.queryAllByText(/Faz3 Kart/).length).toBe(0);
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("başka dosyanın önizlemesiyle onayı açmaz", async () => {
    const file = new File(["ad,kategori\n"], "liste.csv", { type: "text/csv" });
    action.mockResolvedValue({
      ok: true,
      message: "Önizleme hazır. Kayıt yazılmadı.",
      preview: previewFor(buildCatalogSource({ name: "liste.csv", text: "baska", bytes: new TextEncoder().encode("baska") }, [])),
      committed: false,
    });
    render(<CatalogImport />);
    const input = screen.getByLabelText("Katalog dosyası") as HTMLInputElement;
    chooseFile(input, file);
    fireEvent.submit(input.form!);
    expect(await screen.findByText("Önizleme hazır. Kayıt yazılmadı.")).toBeTruthy();
    expect(screen.queryAllByText(/Faz3 Kart/).length).toBe(0);
    expect((screen.getByRole("button", { name: "İçe aktarmayı onayla" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
