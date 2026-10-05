/**
 * Kath intentionally does not replace Theia's ApplicationShell.
 *
 * Earlier releases used a custom ApplicationShell subclass solely to insert the
 * Run/Debug toolbar. That shell injected the toolbar while the toolbar injected
 * ApplicationShell for saveAll(), creating a circular Inversify dependency.
 * Toolbar placement is now performed after the standard shell has been created
 * by InuContribution.installToolbarBelowMenu().
 */
export const INU_USES_STANDARD_THEIA_APPLICATION_SHELL = true;
