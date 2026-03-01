export interface JwtPayload {
  sub: string; // User ID
  iss: string; // Issuer
  preferred_username?: string;
  email?: string;
  groups?: string[];
  // Add other standard JWT claims as needed
  iat?: number;
  exp?: number;
}
