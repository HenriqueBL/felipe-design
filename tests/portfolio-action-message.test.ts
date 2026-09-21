import { describe, expect, it } from "vitest";
import { portfolioActionMessage, type PortfolioActionLabels } from "@/lib/portfolio-action-message";

const EN_LABELS: PortfolioActionLabels = {
  forbidden: "You do not have permission.",
  invalidInput: "Check the form fields.",
  imageRequired: "An image is required.",
  imageInvalid: "Invalid image.",
  createFailed: "Could not create.",
  updateFailed: "Could not update.",
  publishFailed: "Could not publish.",
  featuredFailed: "Could not set featured.",
  clearFeaturedFailed: "Could not clear featured.",
  reorderFailed: "Could not reorder.",
  notFound: "Not found.",
  deleteFailed: "Could not delete.",
  created: "Item created.",
  updated: "Item updated.",
  publishedAction: "Item published.",
  unpublished: "Item unpublished.",
  featuredSet: "Set as featured.",
  featuredCleared: "Featured removed.",
  reordered: "Reordered.",
  deleted: "Deleted.",
};

const PT_LABELS: PortfolioActionLabels = {
  forbidden: "Sem permissão.",
  invalidInput: "Verifique os campos.",
  imageRequired: "Imagem obrigatória.",
  imageInvalid: "Imagem inválida.",
  createFailed: "Erro ao criar.",
  updateFailed: "Erro ao atualizar.",
  publishFailed: "Erro ao publicar.",
  featuredFailed: "Erro ao destacar.",
  clearFeaturedFailed: "Erro ao remover destaque.",
  reorderFailed: "Erro ao reordenar.",
  notFound: "Não encontrado.",
  deleteFailed: "Erro ao excluir.",
  created: "Item criado.",
  updated: "Item atualizado.",
  publishedAction: "Item publicado.",
  unpublished: "Item despublicado.",
  featuredSet: "Destacado.",
  featuredCleared: "Destaque removido.",
  reordered: "Reordenado.",
  deleted: "Excluído.",
};

describe("portfolioActionMessage", () => {
  it("maps 'created' code to EN label", () => {
    expect(portfolioActionMessage("created", EN_LABELS)).toBe("Item created.");
  });

  it("maps 'image_invalid' code to EN label", () => {
    expect(portfolioActionMessage("image_invalid", EN_LABELS)).toBe("Invalid image.");
  });

  it("maps 'featured_cleared' code to EN label (not featured_set)", () => {
    expect(portfolioActionMessage("featured_cleared", EN_LABELS)).toBe("Featured removed.");
  });

  it("maps 'forbidden' code to EN label", () => {
    expect(portfolioActionMessage("forbidden", EN_LABELS)).toBe("You do not have permission.");
  });

  it("maps 'created' code to PT label", () => {
    expect(portfolioActionMessage("created", PT_LABELS)).toBe("Item criado.");
  });

  it("maps 'featured_cleared' code to PT label", () => {
    expect(portfolioActionMessage("featured_cleared", PT_LABELS)).toBe("Destaque removido.");
  });

  it("returns undefined for null/undefined code", () => {
    expect(portfolioActionMessage(null, EN_LABELS)).toBeUndefined();
    expect(portfolioActionMessage(undefined, EN_LABELS)).toBeUndefined();
  });

  it("maps all 20 action codes without returning undefined", () => {
    const allCodes = [
      "forbidden", "invalid_input", "image_required", "image_invalid",
      "create_failed", "update_failed", "publish_failed", "featured_failed",
      "clear_featured_failed", "reorder_failed", "not_found", "delete_failed",
      "created", "updated", "published", "unpublished",
      "featured_set", "featured_cleared", "reordered", "deleted",
    ] as const;
    for (const code of allCodes) {
      const result = portfolioActionMessage(code, EN_LABELS);
      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
      expect(result!.length).toBeGreaterThan(0);
    }
  });
});