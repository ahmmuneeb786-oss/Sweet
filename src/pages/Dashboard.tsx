import { useIsMobile } from '../hooks/useIsMobile';
import { DesktopDashboard } from '../components/DesktopDashboard';
import { MobileDashboard } from '../components/MobileDashboard';

export function Dashboard(props: any) {
  const isMobile = useIsMobile();

  return isMobile ? (
    <MobileDashboard {...props} />
  ) : (
    <DesktopDashboard {...props} />
  );
}