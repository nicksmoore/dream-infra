import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Landing from "./pages/Landing.tsx";
import Index from "./pages/Index.tsx";
import Auth from "./pages/Auth.tsx";
import BrandHub from "./pages/BrandHub.tsx";
import GoldenPath from "./pages/GoldenPath.tsx";
import Backstage from "./pages/Backstage.tsx";
import Migrate from "./pages/Migrate.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/console" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/brand" element={<ProtectedRoute><BrandHub /></ProtectedRoute>} />
            <Route path="/golden-path" element={<ProtectedRoute><GoldenPath /></ProtectedRoute>} />
            <Route path="/backstage" element={<ProtectedRoute><Backstage /></ProtectedRoute>} />
            <Route path="/migrate" element={<ProtectedRoute><Migrate /></ProtectedRoute>} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
