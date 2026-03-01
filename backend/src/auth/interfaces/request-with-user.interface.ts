export interface RequestWithUser extends Request {
  user: {
    userId: string;
    username?: string;
    email?: string;
    groups?: string[];
  };
}
