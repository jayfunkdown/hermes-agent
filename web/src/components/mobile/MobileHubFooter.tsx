import { AuthWidget } from "@/components/AuthWidget";
import { ProfileSwitcher } from "@/components/ProfileSwitcher";

interface MobileHubFooterProps {
  isMobileLayout: boolean;
}

export function MobileHubFooter({ isMobileLayout }: MobileHubFooterProps) {
  return (
    <footer className="shrink-0 space-y-2 border-t border-current/10 px-4 py-3">
      {!isMobileLayout ? <ProfileSwitcher /> : null}
      <AuthWidget
        compact={isMobileLayout}
        className={isMobileLayout ? "border-0 px-0 py-0" : undefined}
      />
    </footer>
  );
}
