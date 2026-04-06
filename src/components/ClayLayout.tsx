import { ReactNode } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Box, ArrowLeft } from "lucide-react";
import { UserMenu } from "@/components/UserMenu";

interface ClayLayoutProps {
  children: ReactNode;
  showBack?: boolean;
  backTo?: string;
  backLabel?: string;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  nav?: ReactNode;
  maxWidth?: string;
  fullWidth?: boolean;
}

export function ClayLayout({
  children,
  showBack,
  backTo = "/console",
  backLabel = "Back",
  title,
  subtitle,
  actions,
  nav,
  maxWidth = "1200px",
  fullWidth = false,
}: ClayLayoutProps) {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#f5f4f0] text-[#1a1a1a]" style={{ fontFamily: "'Instrument Sans', 'Inter', sans-serif" }}>
      {/* Nav */}
      <header className="sticky top-0 z-50 bg-[#f5f4f0]/80 backdrop-blur-xl border-b border-[#e8e7e4]">
        <div className="mx-auto px-8 h-[64px] flex items-center justify-between" style={{ maxWidth }}>
          <div className="flex items-center gap-4">
            {showBack && (
              <button
                onClick={() => navigate(backTo)}
                className="flex items-center gap-1.5 text-sm text-[#888] hover:text-[#1a1a1a] transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                {backLabel}
              </button>
            )}
            <Link to="/" className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-[#1a1a1a] flex items-center justify-center">
                <Box className="h-4 w-4 text-white" />
              </div>
              <span className="text-lg font-semibold tracking-tight" style={{ fontFamily: "'DM Serif Display', serif" }}>naawi</span>
            </Link>
            {title && (
              <>
                <span className="text-[#ddd] mx-1">/</span>
                <div>
                  <span className="text-sm font-medium text-[#1a1a1a]">{title}</span>
                  {subtitle && <p className="text-[10px] text-[#999] leading-tight">{subtitle}</p>}
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            {nav}
            {actions}
            <UserMenu />
          </div>
        </div>
      </header>

      <main className={fullWidth ? "" : "mx-auto px-8 py-8"} style={fullWidth ? {} : { maxWidth }}>
        {children}
      </main>
    </div>
  );
}
