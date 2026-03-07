export interface User {
  id: string;
  username: string;
  email: string;
  groups: string[];
  displayName?: string | null;
  createdAt?: string;
}

export interface UserProfile extends User {
  createdAt: string;
  resourceCounts: {
    domains: number;
    certificates: number;
    apiKeys: number;
  };
}

export interface UpdateProfileRequest {
  displayName?: string;
}
