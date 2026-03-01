export interface Domain {
    id: string;
    hostname: string;
    verificationCode: string;
    isVerified: boolean;
    userId: string;
    createdAt: string;
    updatedAt: string;
}

export interface CreateDomainRequest {
    hostname: string;
}
