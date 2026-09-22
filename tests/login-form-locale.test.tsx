/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LoginForm from "@/components/login-form";

const signInWithOtp = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({
    auth: { signInWithOtp },
  }),
}));

vi.mock("@/lib/site", () => ({
  siteUrl: () => "https://felipesilvadesign.com",
}));

const labels = {
  emailLabel: "Email",
  emailPlaceholder: "you@example.com",
  submit: "Sign in",
  success: "Check your inbox",
  error: "Something went wrong",
  rateLimited: "Too many attempts",
};

beforeEach(() => {
  signInWithOtp.mockReset();
  signInWithOtp.mockResolvedValue({ error: null });
});

function getRedirectTo(): string {
  const call = signInWithOtp.mock.calls[0];
  if (!call) throw new Error("signInWithOtp was not called");
  const opts = call[0] as { options?: { emailRedirectTo?: string } };
  const redirectTo = opts?.options?.emailRedirectTo;
  if (!redirectTo) throw new Error("emailRedirectTo not set");
  return redirectTo;
}

describe("LoginForm locale-default callback destination", () => {
  it("sends next=/en when locale is en and no next prop", async () => {
    render(<LoginForm locale="en" labels={labels} />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "test@example.com" },
    });
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(signInWithOtp).toHaveBeenCalled());
    const url = new URL(getRedirectTo());
    expect(url.searchParams.get("next")).toBe("/en");
  });

  it("sends next=/pt when locale is pt and no next prop", async () => {
    render(<LoginForm locale="pt" labels={labels} />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "test@example.com" },
    });
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(signInWithOtp).toHaveBeenCalled());
    const url = new URL(getRedirectTo());
    expect(url.searchParams.get("next")).toBe("/pt");
  });

  it("preserves explicit next over locale default", async () => {
    render(<LoginForm locale="pt" labels={labels} next="/pt/conta" />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "test@example.com" },
    });
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(signInWithOtp).toHaveBeenCalled());
    const url = new URL(getRedirectTo());
    expect(url.searchParams.get("next")).toBe("/pt/conta");
  });

  it("uses canonical siteUrl origin, never window.location", async () => {
    render(<LoginForm locale="en" labels={labels} />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "test@example.com" },
    });
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(signInWithOtp).toHaveBeenCalled());
    const redirectTo = getRedirectTo();
    expect(redirectTo).toContain("https://felipesilvadesign.com/auth/callback");
    expect(redirectTo).not.toContain("localhost");
    expect(redirectTo).not.toContain("0.0.0.0");
  });
});