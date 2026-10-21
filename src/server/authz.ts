import { ForbiddenError } from "./errors";

export const ROLES = ["owner", "manager", "staff", "restricted_staff", "read_only"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
  restricted_staff: "Restricted staff",
  read_only: "Read-only",
};

/** Authenticated principal. tenantId always comes from a verified membership, never from input. */
export interface Actor {
  userId: string;
  tenantId: string;
  role: Role;
  name: string;
  email: string;
}

const ALL: Role[] = [...ROLES];
const WRITERS: Role[] = ["owner", "manager", "staff"];
const MANAGERS: Role[] = ["owner", "manager"];

export const PERMISSIONS = {
  "contacts.read": ALL,
  /** Unmasked email/phone. Restricted staff and read-only users see masked values. */
  "contacts.read_sensitive": WRITERS,
  "contacts.write": WRITERS,
  "opportunities.write": WRITERS,
  "tasks.complete_any": WRITERS,
  "tasks.complete_own": [...WRITERS, "restricted_staff"],
  "notes.write": [...WRITERS, "restricted_staff"],
  "workflows.read": ["owner", "manager", "staff", "read_only"],
  "workflows.edit": MANAGERS,
  "workflows.publish": MANAGERS,
  "workflows.operate": MANAGERS,
  "export.data": MANAGERS,
  "audit.read": MANAGERS,
  "members.manage": ["owner"],
  "forms.manage": MANAGERS,
  "sending.control": MANAGERS,
} satisfies Record<string, Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(actor: Pick<Actor, "role">, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(actor.role);
}

export function authorize(actor: Pick<Actor, "role">, permission: Permission): void {
  if (!can(actor, permission)) throw new ForbiddenError(`Your role cannot perform: ${permission}`);
}

export function maskEmail(email: string | null): string | null {
  if (!email) return email;
  const [local, domain] = email.split("@");
  return `${(local ?? "").slice(0, 1)}•••@${domain ?? ""}`;
}
export function maskPhone(phone: string | null): string | null {
  if (!phone) return phone;
  return `•••-•••-${phone.replace(/\D/g, "").slice(-4)}`;
}
