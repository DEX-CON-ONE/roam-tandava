import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { AuthProvider } from "@/contexts/AuthContext";
import { DemoProvider } from "@/contexts/DemoContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { LocaleProvider } from "@/contexts/LocaleContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AuthCallback } from "@/components/auth/AuthCallback";
import { MarketingRoute } from "@/components/RootRedirect";
import { LiveOnly } from "@/components/LiveOnly";
// DemoPanel removed — role selection now happens on landing page + DemoRoleBar
import { DemoRoleBar } from "@/components/DemoRoleBar";
import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";
import { brand } from "@/config/brand";

// ---------------------------------------------------------------------------
// Error Boundary — shows the crash instead of a black screen
// ---------------------------------------------------------------------------
class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${brand.name}] Render crash:`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f0a14", color: "#f5f0e8", fontFamily: "'DM Sans', sans-serif", padding: "2rem" }}>
          <div style={{ maxWidth: "32rem", textAlign: "center" }}>
            <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "2rem", marginBottom: "1rem" }}>Something went wrong</h1>
            <p style={{ opacity: 0.7, marginBottom: "1.5rem" }}>{brand.name} encountered an error during startup.</p>
            <pre style={{ textAlign: "left", background: "rgba(255,255,255,0.05)", padding: "1rem", borderRadius: "0.5rem", fontSize: "0.75rem", overflow: "auto", maxHeight: "12rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {this.state.error.message}
              {"\n\n"}
              {this.state.error.stack}
            </pre>
            <button onClick={() => window.location.reload()} style={{ marginTop: "1.5rem", padding: "0.5rem 1.5rem", background: "#4fd1c5", color: "#0f0a14", border: "none", borderRadius: "0.375rem", cursor: "pointer", fontWeight: 600 }}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Platform marketing pages are left out of the bundle on single-studio builds
// (VITE_ROOT_REDIRECT_URL); their routes redirect instead (see MarketingRoute).
// Screens that still render sample data are left out in live-data-only mode
// (VITE_LIVE_DATA_ONLY); their routes show an empty state (see LiveOnly).
const NoPage = () => null;
const Home = lazy(() => import("./pages/Home"));
const StudioStorefront = lazy(() => import("./pages/StudioStorefront"));
const Index = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/Index"));
const Schedule = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/Schedule"));
const MySchedule = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/MySchedule"));
const Community = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/Community"));
const Account = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/Account"));
const Studios = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/Studios"));
const StudioDetail = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/StudioDetail"));
const Instructors = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/Instructors"));
const InstructorDetail = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/InstructorDetail"));
const OnDemand = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/OnDemand"));
const Login = lazy(() => import("./pages/auth/Login"));
const Register = lazy(() => import("./pages/auth/Register"));
const ResetPassword = lazy(() => import("./pages/auth/ResetPassword"));
const ResetPasswordConfirm = lazy(() => import("./pages/auth/ResetPasswordConfirm"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Demo = import.meta.env.VITE_ROOT_REDIRECT_URL ? NoPage : lazy(() => import("./pages/Demo"));
const OpenSource = import.meta.env.VITE_ROOT_REDIRECT_URL ? NoPage : lazy(() => import("./pages/OpenSource"));
const StudioCalculator = import.meta.env.VITE_ROOT_REDIRECT_URL ? NoPage : lazy(() => import("./pages/tools/StudioCalculator"));
const Blog = import.meta.env.VITE_ROOT_REDIRECT_URL ? NoPage : lazy(() => import("./pages/Blog"));
const BlogCategory = import.meta.env.VITE_ROOT_REDIRECT_URL ? NoPage : lazy(() => import("./pages/blog/BlogCategory"));
const BlogPost = import.meta.env.VITE_ROOT_REDIRECT_URL ? NoPage : lazy(() => import("./pages/blog/BlogPost"));

const ManageDashboard = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/Dashboard"));
const ScheduleManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/ScheduleManage"));
const StudentsManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/Students"));
const TeachersManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/Teachers"));
const OfferingsManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/Offerings"));
const FinancialsManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/Financials"));
const ReportsManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/Reports"));
const ImportManage = lazy(() => import("./pages/manage/Import"));
const SettingsManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/Settings"));
const OnboardingManage = lazy(() => import("./pages/manage/Onboarding"));
const MemberDetailManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/MemberDetail"));
const PromoCodesManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/PromoCodes"));
const EventsManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/Events"));
const LandingPagesManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/LandingPages"));
const AnalyticsHubManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/AnalyticsHub"));
const MemberAnalyticsManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/MemberAnalytics"));
const SalesAnalyticsManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/SalesAnalytics"));
const FinancialAnalyticsManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/FinancialAnalytics"));
const SiteAnalyticsManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/SiteAnalytics"));
const DataConnectorsManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/DataConnectors"));
const ProductsManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/Products"));
const InventoryManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/Inventory"));
const PurchaseOrdersManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/PurchaseOrders"));
const NotificationSettingsManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/NotificationSettings"));
const SmsInboxManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/SmsInbox"));
const UtmBuilderManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/UtmBuilder"));
const CampaignsManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/Campaigns"));
const TasksManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/Tasks"));
const OnDemandManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/OnDemand"));
const FeatureSettingsManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/FeatureSettings"));
const AuditLogsManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/AuditLogs"));
const DataDictionaryManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/DataDictionary"));
const DefinitionsManage = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/manage/Definitions"));
const EmbedSettingsManage = lazy(() => import("./pages/manage/EmbedSettings"));

const NotificationPreferences = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/account/NotificationPreferences"));

const TeachDashboard = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/teach/Dashboard"));
const TeachSchedule = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/teach/Schedule"));
const TeachSubs = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/teach/Subs"));
const TeachEarnings = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/teach/Earnings"));
const TeachAvailability = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/teach/Availability"));
const TeachProfile = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/teach/Profile"));

const StaffCheckin = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/staff/StaffCheckin"));
const StaffWaitlist = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/staff/StaffWaitlist"));

const Kiosk = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/Kiosk"));

const EmbedSchedule = lazy(() => import("./pages/embed/EmbedSchedule"));
const EmbedEvent = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/embed/EmbedEvent"));

const AdminDashboard = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/admin/AdminDashboard"));
const AdminStudios = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/admin/AdminStudios"));
const AdminUsers = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/admin/AdminUsers"));
const AdminBilling = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/admin/AdminBilling"));
const AdminFeedback = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/admin/AdminFeedback"));
const AdminSettings = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? NoPage : lazy(() => import("./pages/admin/AdminSettings"));

const queryClient = new QueryClient();

const RouteLoadingFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

const App = () => (
  <AppErrorBoundary>
  <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
      <DemoProvider>
        <ThemeProvider>
          <AuthProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              <BrowserRouter>
                <DemoRoleBar />
                <Suspense fallback={<RouteLoadingFallback />}>
                <Routes>
                  {/* ---- Root: resolves to the demo landing in demo mode, or the
                       real platform landing / user's workspace in production
                       (see pages/Home.tsx). The demo role picker stays at /demo. ---- */}
                  <Route path="/" element={<Home />} />
                  <Route path="/demo" element={<MarketingRoute><Demo /></MarketingRoute>} />
                  <Route path="/open-source" element={<MarketingRoute><OpenSource /></MarketingRoute>} />
                  <Route path="/tools/studio-calculator" element={<MarketingRoute><StudioCalculator /></MarketingRoute>} />

                  {/* ---- Public studio storefront (slug-driven; what per-studio
                       subdomains will render). Gated on studios.discoverable. ---- */}
                  <Route path="/s/:slug" element={<StudioStorefront />} />

                  {/* ---- Blog (built but not yet linked in nav; noindex until
                       BLOG_PUBLISHED is flipped on in src/config/blog.ts) ---- */}
                  <Route path="/blog" element={<MarketingRoute><Blog /></MarketingRoute>} />
                  <Route path="/blog/category/:category" element={<MarketingRoute><BlogCategory /></MarketingRoute>} />
                  <Route path="/blog/:slug" element={<MarketingRoute><BlogPost /></MarketingRoute>} />

                  {/* ---- Student-facing routes ---- */}
                  <Route path="/home" element={<LiveOnly><Index /></LiveOnly>} />
                  <Route path="/schedule" element={<LiveOnly><Schedule /></LiveOnly>} />
                  <Route path="/events" element={<LiveOnly><Studios /></LiveOnly>} />
                  <Route path="/events/:id" element={<LiveOnly><StudioDetail /></LiveOnly>} />
                  <Route path="/instructors" element={<LiveOnly><Instructors /></LiveOnly>} />
                  <Route path="/instructors/:id" element={<LiveOnly><InstructorDetail /></LiveOnly>} />
                  <Route path="/on-demand" element={<LiveOnly><OnDemand /></LiveOnly>} />

                  {/* ---- Auth routes ---- */}
                  <Route path="/auth/login" element={<Login />} />
                  <Route path="/auth/register" element={<Register />} />
                  <Route path="/auth/reset" element={<ResetPassword />} />
                  <Route path="/auth/reset-confirm" element={<ResetPasswordConfirm />} />
                  <Route path="/auth/callback" element={<AuthCallback />} />

                  {/* ---- Authenticated member routes ---- */}
                  <Route path="/my-schedule" element={<LiveOnly><ProtectedRoute permission="member.view_profile"><MySchedule /></ProtectedRoute></LiveOnly>} />
                  <Route path="/community" element={<LiveOnly><ProtectedRoute permission="member.view_profile"><Community /></ProtectedRoute></LiveOnly>} />
                  <Route path="/account" element={<LiveOnly><ProtectedRoute permission="member.view_profile"><Account /></ProtectedRoute></LiveOnly>} />
                  <Route path="/account/notifications" element={<LiveOnly><ProtectedRoute permission="member.view_profile"><NotificationPreferences /></ProtectedRoute></LiveOnly>} />

                  {/* ---- Platform admin routes (/admin) ---- */}
                  <Route path="/admin" element={<LiveOnly><ProtectedRoute permission="platform.admin"><AdminDashboard /></ProtectedRoute></LiveOnly>} />
                  <Route path="/admin/studios" element={<LiveOnly><ProtectedRoute permission="platform.manage_studios"><AdminStudios /></ProtectedRoute></LiveOnly>} />
                  <Route path="/admin/users" element={<LiveOnly><ProtectedRoute permission="platform.manage_users"><AdminUsers /></ProtectedRoute></LiveOnly>} />
                  <Route path="/admin/billing" element={<LiveOnly><ProtectedRoute permission="platform.manage_billing"><AdminBilling /></ProtectedRoute></LiveOnly>} />
                  <Route path="/admin/feedback" element={<LiveOnly><ProtectedRoute permission="platform.admin"><AdminFeedback /></ProtectedRoute></LiveOnly>} />
                  <Route path="/admin/settings" element={<LiveOnly><ProtectedRoute permission="platform.admin"><AdminSettings /></ProtectedRoute></LiveOnly>} />

                  {/* ---- Studio management routes (/manage) ----
                       Guards: "studio.manage_schedule" = owner + admin (day-to-day mgmt);
                               "studio.manage_settings"  = owner only (settings, money, growth).
                       Demo mode bypasses all guards (see ProtectedRoute). */}
                  <Route path="/manage" element={<LiveOnly><ProtectedRoute permission="studio.manage_schedule"><ManageDashboard /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/schedule" element={<LiveOnly><ProtectedRoute permission="studio.manage_schedule"><ScheduleManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/students" element={<LiveOnly><ProtectedRoute permission="studio.manage_schedule"><StudentsManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/teachers" element={<LiveOnly><ProtectedRoute permission="studio.manage_schedule"><TeachersManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/offerings" element={<LiveOnly><ProtectedRoute permission="studio.manage_schedule"><OfferingsManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/financials" element={<LiveOnly><ProtectedRoute permission="studio.manage_settings"><FinancialsManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/reports" element={<LiveOnly><ProtectedRoute permission="studio.manage_schedule"><ReportsManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/import" element={<ProtectedRoute permission="studio.manage_settings"><ImportManage /></ProtectedRoute>} />
                  <Route path="/manage/settings" element={<LiveOnly><ProtectedRoute permission="studio.manage_settings"><SettingsManage /></ProtectedRoute></LiveOnly>} />
                  {/* No permission gate: this is where a new owner *creates* their
                       studio, before they hold any studio role. Authenticated-only;
                       the onboarding edge function authorizes each write. */}
                  <Route path="/manage/onboarding" element={<ProtectedRoute><OnboardingManage /></ProtectedRoute>} />
                  <Route path="/manage/members/:id" element={<LiveOnly><ProtectedRoute permission="studio.manage_schedule"><MemberDetailManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/promo-codes" element={<LiveOnly><ProtectedRoute permission="studio.manage_settings"><PromoCodesManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/events" element={<LiveOnly><ProtectedRoute permission="studio.manage_schedule"><EventsManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/landing-pages" element={<LiveOnly><ProtectedRoute permission="studio.manage_settings"><LandingPagesManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/analytics" element={<LiveOnly><ProtectedRoute permission="studio.manage_schedule"><AnalyticsHubManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/analytics/members" element={<LiveOnly><ProtectedRoute permission="studio.manage_schedule"><MemberAnalyticsManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/analytics/sales" element={<LiveOnly><ProtectedRoute permission="studio.manage_settings"><SalesAnalyticsManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/analytics/financials" element={<LiveOnly><ProtectedRoute permission="studio.manage_settings"><FinancialAnalyticsManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/analytics/site" element={<LiveOnly><ProtectedRoute permission="studio.manage_schedule"><SiteAnalyticsManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/connectors" element={<LiveOnly><ProtectedRoute permission="studio.manage_settings"><DataConnectorsManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/products" element={<LiveOnly><ProtectedRoute permission="studio.manage_schedule"><ProductsManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/inventory" element={<LiveOnly><ProtectedRoute permission="studio.manage_schedule"><InventoryManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/purchase-orders" element={<LiveOnly><ProtectedRoute permission="studio.manage_settings"><PurchaseOrdersManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/notification-settings" element={<LiveOnly><ProtectedRoute permission="studio.manage_settings"><NotificationSettingsManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/sms-inbox" element={<LiveOnly><ProtectedRoute permission="studio.view_inbox"><SmsInboxManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/utm-builder" element={<LiveOnly><ProtectedRoute permission="studio.manage_settings"><UtmBuilderManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/campaigns" element={<LiveOnly><ProtectedRoute permission="studio.manage_settings"><CampaignsManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/tasks" element={<LiveOnly><ProtectedRoute permission="studio.manage_schedule"><TasksManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/on-demand" element={<LiveOnly><ProtectedRoute permission="studio.manage_schedule"><OnDemandManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/feature-settings" element={<LiveOnly><ProtectedRoute permission="studio.manage_settings"><FeatureSettingsManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/audit-logs" element={<LiveOnly><ProtectedRoute permission="studio.manage_settings"><AuditLogsManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/data-dictionary" element={<LiveOnly><ProtectedRoute permission="studio.manage_schedule"><DataDictionaryManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/definitions" element={<LiveOnly><ProtectedRoute permission="studio.manage_schedule"><DefinitionsManage /></ProtectedRoute></LiveOnly>} />
                  <Route path="/manage/embed" element={<ProtectedRoute permission="studio.manage_settings"><EmbedSettingsManage /></ProtectedRoute>} />

                  {/* ---- Instructor portal routes (/teach) ---- */}
                  <Route path="/teach" element={<LiveOnly><ProtectedRoute permission="studio.teach"><TeachDashboard /></ProtectedRoute></LiveOnly>} />
                  <Route path="/teach/schedule" element={<LiveOnly><ProtectedRoute permission="studio.teach"><TeachSchedule /></ProtectedRoute></LiveOnly>} />
                  <Route path="/teach/availability" element={<LiveOnly><ProtectedRoute permission="studio.teach"><TeachAvailability /></ProtectedRoute></LiveOnly>} />
                  <Route path="/teach/subs" element={<LiveOnly><ProtectedRoute permission="studio.teach"><TeachSubs /></ProtectedRoute></LiveOnly>} />
                  <Route path="/teach/earnings" element={<LiveOnly><ProtectedRoute permission="studio.teach"><TeachEarnings /></ProtectedRoute></LiveOnly>} />
                  <Route path="/teach/profile" element={<LiveOnly><ProtectedRoute permission="studio.teach"><TeachProfile /></ProtectedRoute></LiveOnly>} />

                  {/* ---- Staff (front desk) routes ---- */}
                  <Route path="/staff/checkin" element={<LiveOnly><ProtectedRoute permission="studio.checkin"><StaffCheckin /></ProtectedRoute></LiveOnly>} />
                  <Route path="/staff/waitlist" element={<LiveOnly><ProtectedRoute permission="studio.manage_waitlist"><StaffWaitlist /></ProtectedRoute></LiveOnly>} />

                  {/* ---- Embeddable widget (chrome-less, public) ---- */}
                  <Route path="/embed/schedule/:slug" element={<EmbedSchedule />} />
                  <Route path="/embed/event/:id" element={<LiveOnly><EmbedEvent /></LiveOnly>} />

                  {/* ---- Kiosk mode ---- */}
                  <Route path="/kiosk/:studioId" element={<LiveOnly><Kiosk /></LiveOnly>} />

                  {/* ---- Catch-all ---- */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
                </Suspense>
              </BrowserRouter>
            </TooltipProvider>
          </AuthProvider>
        </ThemeProvider>
      </DemoProvider>
      </LocaleProvider>
    </QueryClientProvider>
  </HelmetProvider>
  </AppErrorBoundary>
);

export default App;
