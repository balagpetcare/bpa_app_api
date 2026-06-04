import type { SmsProvider, SmsSendContext, SmsSendResult } from "./types";

/**
 * Log-only provider for development and automated tests.
 */
export class MockSmsProvider implements SmsProvider {
  readonly name = "mock";
  static sent: Array<{ phone: string; message: string; context?: SmsSendContext }> = [];

  isConfigured(): boolean {
    return true;
  }

  async send(phone: string, message: string, context?: SmsSendContext): Promise<SmsSendResult> {
    MockSmsProvider.sent.push({ phone, message, context });
    const messageId = `mock-${Date.now()}-${MockSmsProvider.sent.length}`;
    if (process.env.NODE_ENV !== "test") {
      console.log(`[MockSmsProvider] to=${phone} id=${messageId} text=${message.slice(0, 80)}`);
    }
    return { success: true, provider: this.name, messageId };
  }

  static reset(): void {
    MockSmsProvider.sent = [];
  }
}

export const mockSmsProvider = new MockSmsProvider();
