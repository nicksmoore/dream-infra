import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Box } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f4f0]" style={{ fontFamily: "'Instrument Sans', 'Inter', sans-serif" }}>
      <div className="text-center">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="h-8 w-8 rounded-full bg-[#1a1a1a] flex items-center justify-center">
            <Box className="h-4 w-4 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight" style={{ fontFamily: "'DM Serif Display', serif" }}>naawi</span>
        </div>
        <h1 className="text-7xl font-light tracking-tight text-[#ddd] mb-4" style={{ fontFamily: "'DM Serif Display', serif" }}>404</h1>
        <p className="text-lg text-[#888] mb-6">Page not found</p>
        <a href="/" className="text-sm text-[hsl(199,89%,48%)] hover:underline font-medium">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
