import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  session: vi.fn(),
  from: vi.fn(),
  ilike: vi.fn(),
  eq: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("@/lib/require-role", () => ({ requireCompanySession: mock.session }));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({ from: mock.from }),
}));
import { canUseEmployeePreview } from "../preview-access";
beforeEach(() => {
  vi.clearAllMocks();
  mock.session.mockResolvedValue({
    ok: true,
    role: "staff",
    email: "brody@highdesertpm.com",
  });
  mock.from.mockReturnValue({ select: () => ({ ilike: mock.ilike }) });
  mock.ilike.mockReturnValue({ eq: mock.eq });
  mock.eq.mockReturnValue({ limit: mock.limit });
  mock.limit.mockResolvedValue({ data: [{ person: "Brody" }], error: null });
});
describe("employee preview pilot access", () => {
  it("allows Brody through his active directory identity", async () => {
    expect(await canUseEmployeePreview()).toBe(true);
    expect(mock.ilike).toHaveBeenCalledWith("email", "brody@highdesertpm.com");
    expect(mock.eq).toHaveBeenCalledWith("active", true);
    expect(mock.from).toHaveBeenCalledWith("staff");
  });
  it.each([
    { data: [], error: null },
    { data: [{ person: "Ashley" }], error: null },
    { data: [{ person: "Brody" }, { person: "Other" }], error: null },
    { data: null, error: { message: "unavailable" } },
  ])(
    "denies uninvited, inactive, ambiguous or unavailable accounts",
    async (result) => {
      mock.limit.mockResolvedValue(result);
      expect(await canUseEmployeePreview()).toBe(false);
    },
  );
  it("requires a company session and preserves existing admin access", async () => {
    mock.session.mockResolvedValue({ ok: false });
    expect(await canUseEmployeePreview()).toBe(false);
    expect(mock.from).not.toHaveBeenCalled();
    mock.session.mockResolvedValue({
      ok: true,
      role: "admin",
      email: "craig@highdesertpm.com",
    });
    expect(await canUseEmployeePreview()).toBe(true);
    expect(mock.from).not.toHaveBeenCalled();
  });
});
