/**
 * Frontend-only values for Paper-designed features that do not have control-api
 * contracts yet. Keep these exports isolated so the future API integration is a
 * straightforward replacement instead of being mixed into page components.
 */
export const placeholderGroups = [
  { id: "group-operations", name: "Operations", memberCount: 14, access: "3 apps" },
  { id: "group-finance", name: "Finance", memberCount: 8, access: "2 apps" },
  { id: "group-builders", name: "App builders", memberCount: 11, access: "All draft apps" },
  { id: "group-reviewers", name: "Release reviewers", memberCount: 6, access: "Approvals" },
];

export const placeholderApprovals = [
  {
    id: "approval-production",
    title: "Production deployment",
    subtitle: "Version d84f2a101c · Submitted 12 minutes ago",
    submittedBy: "Maya Chen",
    validation: "All checks passed",
    expires: "In 23 hours",
    source: "main@d84f2a1",
    changes: ["2 new capabilities · customer.read, invoice.export", "1 managed schema migration"],
  },
  {
    id: "approval-data",
    title: "Data access increase",
    subtitle: "Nora Singh · 2 new capabilities · expires tomorrow",
    submittedBy: "Nora Singh",
    validation: "Policy review pending",
    expires: "Tomorrow",
    source: "main@91ca0bd",
    changes: ["Read access to billing.invoices", "Export access for monthly reporting"],
  },
];

export const placeholderSessionTrend = [42, 58, 52, 69, 64, 82, 76, 91, 87, 101, 97, 112];
export const placeholderCompletionTrend = [34, 49, 45, 57, 54, 70, 65, 78, 73, 89, 84, 96];
