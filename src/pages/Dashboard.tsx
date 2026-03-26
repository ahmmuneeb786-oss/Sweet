import { useIsMobile } from '../hooks/useIsMobile';
import { DesktopDashboard } from '../components/DesktopDashboard';
import { MobileDashboard } from '../components/MobileDashboard';

// Check the name here! It must be "Dashboard" to match your App.tsx import
export function Dashboard(props: any) {
  const isMobile = useIsMobile();

  return isMobile ? (
    <MobileDashboard {...props} />
  ) : (
    <DesktopDashboard {...props} />
  );
}