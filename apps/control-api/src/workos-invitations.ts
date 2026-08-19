import { eq, organizations, type ToolflowDatabase } from "@toolflow/database";

interface WorkOsInvitationClient {
  userManagement: {
    sendInvitation(options: { email: string; organizationId: string }): Promise<unknown>;
  };
}

export interface InvitationSender {
  send(organizationId: string, email: string): Promise<void>;
}

export class WorkOsInvitationSender implements InvitationSender {
  constructor(
    private readonly workos: WorkOsInvitationClient,
    private readonly database: ToolflowDatabase["db"],
  ) {}

  async send(organizationId: string, email: string): Promise<void> {
    const [organization] = await this.database
      .select({ externalIdentityId: organizations.externalIdentityId })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!organization) throw new Error("Toolflow organization was not found.");
    await this.workos.userManagement.sendInvitation({ email, organizationId: organization.externalIdentityId });
  }
}
