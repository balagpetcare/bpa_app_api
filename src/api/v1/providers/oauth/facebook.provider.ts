import { AuthProvider } from "@prisma/client";
import type { OAuthTokenVerifier, VerifiedOAuthProfile } from "./oauth.types";

type FacebookDebugTokenResponse = {
  data?: {
    is_valid?: boolean;
    user_id?: string;
    app_id?: string;
  };
};

type FacebookUserResponse = {
  id?: string;
  name?: string;
  email?: string;
  picture?: {
    data?: {
      url?: string;
    };
  };
};

function getFacebookAppId(): string {
  return String(process.env.FACEBOOK_APP_ID || "").trim();
}

function getFacebookAppSecret(): string {
  return String(process.env.FACEBOOK_APP_SECRET || "").trim();
}

export function isFacebookOAuthConfigured(): boolean {
  return Boolean(getFacebookAppId() && getFacebookAppSecret());
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FACEBOOK_API_ERROR_${res.status}`);
  }
  return (await res.json()) as T;
}

export const facebookOAuthVerifier: OAuthTokenVerifier = {
  providerKey: "FACEBOOK",

  async verify(accessToken: string): Promise<VerifiedOAuthProfile> {
    const appId = getFacebookAppId();
    const appSecret = getFacebookAppSecret();
    if (!appId || !appSecret) {
      throw new Error("FACEBOOK_APP_CREDENTIALS_MISSING");
    }

    const appAccessToken = `${appId}|${appSecret}`;
    const debugUrl = new URL("https://graph.facebook.com/debug_token");
    debugUrl.searchParams.set("input_token", accessToken);
    debugUrl.searchParams.set("access_token", appAccessToken);

    const debug = await fetchJson<FacebookDebugTokenResponse>(debugUrl.toString());
    if (!debug.data?.is_valid) {
      throw new Error("INVALID_FACEBOOK_TOKEN");
    }
    if (debug.data.app_id && debug.data.app_id !== appId) {
      throw new Error("FACEBOOK_TOKEN_WRONG_APP");
    }

    const userId = String(debug.data.user_id || "").trim();
    if (!userId) {
      throw new Error("FACEBOOK_TOKEN_MISSING_USER_ID");
    }

    const userUrl = new URL(`https://graph.facebook.com/${userId}`);
    userUrl.searchParams.set("fields", "id,name,email,picture");
    userUrl.searchParams.set("access_token", accessToken);

    const user = await fetchJson<FacebookUserResponse>(userUrl.toString());
    const emailRaw = String(user.email || "").trim().toLowerCase();
    if (!emailRaw) {
      throw new Error("FACEBOOK_TOKEN_MISSING_EMAIL");
    }

    const pictureUrl = user.picture?.data?.url
      ? String(user.picture.data.url).trim()
      : null;

    return {
      provider: AuthProvider.FACEBOOK,
      providerKey: "FACEBOOK",
      oauthSubject: userId,
      email: emailRaw,
      emailVerified: true,
      displayName: user.name ? String(user.name).trim() : null,
      pictureUrl,
    };
  },
};
