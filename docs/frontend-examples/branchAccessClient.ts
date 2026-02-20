/**
 * Branch Access API Client
 * Frontend helper functions for branch access management
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1';

class BranchAccessClient {
  private getToken(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('token');
    }
    return null;
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    const token = this.getToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || 'Request failed');
    }

    return response.json();
  }

  /**
   * Check if user has access to a branch
   */
  async checkAccess(branchId: number): Promise<boolean> {
    try {
      const data = await this.request(`/branch-access/check/${branchId}`);
      return data.data?.hasAccess || false;
    } catch (error) {
      console.error('Error checking access:', error);
      return false;
    }
  }

  /**
   * Get all permission requests for current user
   */
  async getMyRequests() {
    try {
      const data = await this.request('/branch-access/my-requests');
      return data.data || [];
    } catch (error) {
      console.error('Error fetching requests:', error);
      return [];
    }
  }

  /**
   * Get only active (APPROVED) permissions
   */
  async getActivePermissions() {
    try {
      const data = await this.request('/branch-access/active');
      return data.data || [];
    } catch (error) {
      console.error('Error fetching active permissions:', error);
      return [];
    }
  }

  /**
   * Request access to a branch
   */
  async requestAccess(branchId: number) {
    try {
      const data = await this.request('/branch-access/request', {
        method: 'POST',
        body: JSON.stringify({ branchId }),
      });
      return {
        success: true,
        data: data.data,
        message: data.message,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to request access',
      };
    }
  }

  /**
   * Parse login response to extract branch access info
   */
  parseLoginResponse(loginResponse: any) {
    const branches = loginResponse.user?.branches || [];

    return {
      approved: branches.filter((b: any) => b.accessStatus === 'APPROVED'),
      pending: branches.filter((b: any) => b.accessStatus === 'PENDING'),
      revoked: branches.filter((b: any) => b.accessStatus === 'REVOKED'),
      expired: branches.filter((b: any) => b.accessStatus === 'EXPIRED'),
      all: branches,
      hasAccess: branches.some((b: any) => b.accessStatus === 'APPROVED'),
    };
  }

  /**
   * Check if branch access is expired
   */
  isExpired(expiresAt: string | null): boolean {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  }

  /**
   * Get access status message in Bengali
   */
  getStatusMessage(status: string): string {
    const messages: Record<string, string> = {
      PENDING: 'Manager approval অপেক্ষা করছে',
      APPROVED: 'Access আছে - কাজ করতে পারবেন',
      REVOKED: 'Access revoked হয়েছে',
      EXPIRED: 'Access expire হয়ে গেছে',
    };
    return messages[status] || status;
  }

  /**
   * Get status icon/emoji
   */
  getStatusIcon(status: string): string {
    const icons: Record<string, string> = {
      PENDING: '⏳',
      APPROVED: '✅',
      REVOKED: '❌',
      EXPIRED: '⚠️',
    };
    return icons[status] || '❓';
  }
}

// Export singleton instance
export const branchAccessClient = new BranchAccessClient();

// Export class for custom instances
export default BranchAccessClient;
