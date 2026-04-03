/**
 * Owner Onboarding Controller
 * Enterprise-grade onboarding wizard API endpoints.
 */

import type { Request, Response } from 'express';
import * as onboardingService from '../../services/ownerOnboarding.service';

interface AuthRequest extends Request {
  user?: { id: number };
}

/**
 * GET /owner/onboarding/state
 * Load current onboarding state
 */
export async function getState(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const state = await onboardingService.getOnboardingState(userId);

    return res.status(200).json({
      success: true,
      data: state,
    });
  } catch (e: any) {
    console.error('[ownerOnboarding] getState:', e);
    return res.status(500).json({
      success: false,
      error: { code: 'ONBOARDING_STATE_ERROR', message: e?.message || 'Server error' },
    });
  }
}

/**
 * POST /owner/onboarding/path
 * Save selected onboarding path (CREATE_NEW or JOIN_EXISTING)
 */
export async function savePath(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { selectedPath } = req.body || {};

    if (!selectedPath || !['CREATE_NEW', 'JOIN_EXISTING'].includes(selectedPath)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ONBOARDING_PATH_REQUIRED',
          message: 'Please select a valid path: CREATE_NEW or JOIN_EXISTING',
        },
      });
    }

    const result = await onboardingService.saveSelectedPath(userId, selectedPath);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (e: any) {
    console.error('[ownerOnboarding] savePath:', e);
    return res.status(500).json({
      success: false,
      error: { code: 'ONBOARDING_PATH_ERROR', message: e?.message || 'Server error' },
    });
  }
}

/**
 * POST /owner/onboarding/draft
 * Save step draft data
 */
export async function saveDraft(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { step, payload } = req.body || {};

    if (!step || typeof step !== 'string') {
      return res.status(400).json({
        success: false,
        error: { code: 'ONBOARDING_STEP_REQUIRED', message: 'Step name is required' },
      });
    }

    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({
        success: false,
        error: { code: 'ONBOARDING_PAYLOAD_REQUIRED', message: 'Payload is required' },
      });
    }

    const result = await onboardingService.saveOnboardingDraft(userId, step.toUpperCase(), payload);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (e: any) {
    console.error('[ownerOnboarding] saveDraft:', e);
    return res.status(500).json({
      success: false,
      error: { code: 'ONBOARDING_DRAFT_ERROR', message: e?.message || 'Server error' },
    });
  }
}

/**
 * GET /owner/onboarding/organizations/options
 * List accessible organizations for JOIN_EXISTING path
 */
export async function getOrganizationOptions(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const organizations = await onboardingService.listAccessibleOrganizations(userId);

    return res.status(200).json({
      success: true,
      data: { organizations },
    });
  } catch (e: any) {
    console.error('[ownerOnboarding] getOrganizationOptions:', e);
    return res.status(500).json({
      success: false,
      error: { code: 'ONBOARDING_ORG_OPTIONS_ERROR', message: e?.message || 'Server error' },
    });
  }
}

/**
 * POST /owner/onboarding/complete
 * Complete onboarding (CREATE_NEW path) - creates org + branch
 */
export async function complete(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { selectedPath, organization, branch, owner } = req.body || {};

    if (selectedPath !== 'CREATE_NEW') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ONBOARDING_INVALID_PATH',
          message: 'This endpoint is for CREATE_NEW path only. Use /join-existing for existing orgs.',
        },
      });
    }

    // Validate organization
    if (!organization?.organizationName || organization.organizationName.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ONBOARDING_ORG_NAME_REQUIRED',
          message: 'Organization name is required (min 2 characters)',
          fieldErrors: { organizationName: 'Organization name is required' },
        },
      });
    }

    if (organization.organizationName.trim().length > 120) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ONBOARDING_ORG_NAME_TOO_LONG',
          message: 'Organization name must be 120 characters or less',
          fieldErrors: { organizationName: 'Organization name is too long' },
        },
      });
    }

    // Validate branch
    if (!branch?.branchName || branch.branchName.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ONBOARDING_BRANCH_NAME_REQUIRED',
          message: 'Branch name is required (min 2 characters)',
          fieldErrors: { branchName: 'Branch name is required' },
        },
      });
    }

    if (branch.branchName.trim().length > 120) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ONBOARDING_BRANCH_NAME_TOO_LONG',
          message: 'Branch name must be 120 characters or less',
          fieldErrors: { branchName: 'Branch name is too long' },
        },
      });
    }

    const result = await onboardingService.completeCreateNewOnboarding(userId, {
      selectedPath,
      organization,
      branch,
      owner,
    });

    return res.status(201).json({
      success: true,
      data: result,
    });
  } catch (e: any) {
    console.error('[ownerOnboarding] complete:', e);

    // Handle specific errors
    if (e?.message?.includes('already have an organization')) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ONBOARDING_ALREADY_COMPLETED',
          message: e.message,
        },
      });
    }

    return res.status(500).json({
      success: false,
      error: { code: 'ONBOARDING_TRANSACTION_FAILED', message: e?.message || 'Server error' },
    });
  }
}

/**
 * POST /owner/onboarding/join-existing
 * Complete onboarding by joining an existing organization
 */
export async function joinExisting(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { organizationId } = req.body || {};

    if (!organizationId || typeof organizationId !== 'number') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ONBOARDING_ORG_ID_REQUIRED',
          message: 'Organization ID is required',
        },
      });
    }

    const result = await onboardingService.completeJoinExistingOnboarding(userId, organizationId);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (e: any) {
    console.error('[ownerOnboarding] joinExisting:', e);

    if (e?.message?.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: { code: 'ONBOARDING_JOIN_TARGET_NOT_FOUND', message: e.message },
      });
    }

    if (e?.message?.includes('do not have access')) {
      return res.status(403).json({
        success: false,
        error: { code: 'ONBOARDING_ACCESS_DENIED', message: e.message },
      });
    }

    return res.status(500).json({
      success: false,
      error: { code: 'ONBOARDING_JOIN_ERROR', message: e?.message || 'Server error' },
    });
  }
}

/**
 * POST /owner/onboarding/reset
 * Reset onboarding draft (start over)
 */
export async function reset(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const result = await onboardingService.resetOnboardingDraft(userId);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (e: any) {
    console.error('[ownerOnboarding] reset:', e);
    return res.status(500).json({
      success: false,
      error: { code: 'ONBOARDING_RESET_ERROR', message: e?.message || 'Server error' },
    });
  }
}

export default {
  getState,
  savePath,
  saveDraft,
  getOrganizationOptions,
  complete,
  joinExisting,
  reset,
};
