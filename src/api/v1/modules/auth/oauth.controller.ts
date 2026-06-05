/**
 * OAuth sign-in (Google + Facebook; other providers return 501 until configured).
 */

import type { Request, Response } from "express";
import {
  facebookOAuthVerifier,
  googleOAuthVerifier,
  isFacebookOAuthConfigured,
  isGoogleOAuthConfigured,
} from "../../providers/oauth";
import { mapOAuthError, performOAuthLogin } from "../../services/oauthLogin.service";

/**
 * POST /api/v1/auth/oauth/google
 * POST /api/v1/auth/social/google
 * Body: { idToken: string }
 */
export async function googleIdTokenLogin(req: Request, res: Response) {
  try {
    const idToken = String((req.body as any)?.idToken || "").trim();
    if (!idToken) {
      return res.status(400).json({ success: false, message: "idToken is required" });
    }

    if (!isGoogleOAuthConfigured()) {
      return res.status(503).json({
        success: false,
        message: "Google sign-in is not configured (GOOGLE_CLIENT_ID missing).",
      });
    }

    const profile = await googleOAuthVerifier.verify(idToken);
    const result = await performOAuthLogin(profile, req, res);
    return res.status(result.status).json(result.body);
  } catch (e: any) {
    console.error("googleIdTokenLogin:", e);
    const mapped = mapOAuthError(e);
    return res.status(mapped.status).json({ success: false, message: mapped.message });
  }
}

/**
 * POST /api/v1/auth/oauth/facebook
 * POST /api/v1/auth/social/facebook
 * Body: { accessToken: string }
 */
export async function facebookAccessTokenLogin(req: Request, res: Response) {
  try {
    const accessToken = String((req.body as any)?.accessToken || "").trim();
    if (!accessToken) {
      return res.status(400).json({ success: false, message: "accessToken is required" });
    }

    if (!isFacebookOAuthConfigured()) {
      return res.status(503).json({
        success: false,
        message:
          "Facebook sign-in is not configured (FACEBOOK_APP_ID / FACEBOOK_APP_SECRET missing).",
      });
    }

    const profile = await facebookOAuthVerifier.verify(accessToken);
    const result = await performOAuthLogin(profile, req, res);
    return res.status(result.status).json(result.body);
  } catch (e: any) {
    console.error("facebookAccessTokenLogin:", e);
    const mapped = mapOAuthError(e);
    return res.status(mapped.status).json({ success: false, message: mapped.message });
  }
}

export async function appleNotImplemented(_req: Request, res: Response) {
  return res.status(501).json({
    success: false,
    message: "Apple sign-in is not enabled yet. Configure Sign in with Apple first.",
  });
}

export async function twitterNotImplemented(_req: Request, res: Response) {
  return res.status(501).json({
    success: false,
    message: "X (Twitter) sign-in is not enabled yet. Configure OAuth 2.0 and token verification first.",
  });
}

const oauth = {
  googleIdTokenLogin,
  facebookAccessTokenLogin,
  appleNotImplemented,
  twitterNotImplemented,
};

(module as any).exports = oauth;
export default oauth;
