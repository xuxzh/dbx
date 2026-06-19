import { Database } from "lucide-react";

interface DatabaseIconProps {
  dbType: string;
  className?: string;
}

// Simplified React version - maps to Lucide Database icon
// Full icon mapping would need asset integration
export function DatabaseIcon({ dbType, className = "" }: DatabaseIconProps) {
  return <Database className={className} />;
}
