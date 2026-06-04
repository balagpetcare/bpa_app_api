import axios from "axios";
import { BulkSmsBdProvider } from "./bulkSmsBd.provider";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("BulkSmsBdProvider", () => {
  const provider = new BulkSmsBdProvider();

  beforeEach(() => {
    process.env.BULKSMSBD_API_TOKEN = "abc-token";
    process.env.BULKSMSBD_SENDER_ID = "BPA";
    process.env.BULKSMSBD_BASE_URL = "https://app.bulksmsbd.xyz";
    process.env.BULKSMSBD_API_MODE = "rest_v3";
    mockedAxios.post.mockReset();
    mockedAxios.get.mockReset();
  });

  it("sends via REST v3 API", async () => {
    mockedAxios.post.mockResolvedValue({
      status: 200,
      data: { status: "success", data: { uid: "bulk-99" } },
    });

    const result = await provider.send("01712345678", "Hello");
    expect(result.success).toBe(true);
    expect(result.messageId).toBe("bulk-99");
  });

  it("supports legacy API mode", async () => {
    process.env.BULKSMSBD_API_MODE = "legacy";
    process.env.BULKSMSBD_API_KEY = "legacy-key";
    mockedAxios.get.mockResolvedValue({ status: 200, data: { response_code: 202, message_id: "legacy-1" } });

    const result = await provider.send("01712345678", "Hello legacy");
    expect(result.success).toBe(true);
    expect(result.messageId).toBe("legacy-1");
  });
});
