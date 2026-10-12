import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { SEOHead } from "@/components/seo/SEOHead";
import { Eye, EyeOff, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MIN_PASSWORD_LENGTH, recoveryLinkError, validateNewPassword } from "@/lib/auth/password-reset";

/**
 * Step 2 of password reset: the emailed link lands here. The auth client turns
 * the link's token into a session on load; with that session the user can set
 * a new password. Without one (expired, already used or mistyped link) they are
 * sent back to request a new link.
 */
const ResetPasswordConfirm = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, isLoading: isAuthLoading, updatePassword } = useAuth();
  const { t } = useTranslation("auth");
  // Read once: the auth client clears the URL fragment after it has used it.
  const [linkError] = useState(() => recoveryLinkError(window.location.hash, window.location.search));
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const problem = validateNewPassword(password, confirmation);
    if (problem) {
      toast({
        title: t("reset.updateFailed"),
        description: problem === "tooShort" ? t("reset.tooShort", { count: MIN_PASSWORD_LENGTH }) : t("reset.mismatch"),
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    const { error } = await updatePassword(password);
    setIsSaving(false);

    if (error) {
      toast({ title: t("reset.updateFailed"), description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: t("reset.updatedTitle"), description: t("reset.updatedBody") });
    navigate("/", { replace: true });
  };

  const seo = <SEOHead title="Set New Password" description="Choose a new password for your account." canonical="/auth/reset-confirm" noindex />;

  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        {seo}
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user || linkError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        {seo}
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">{t("reset.linkInvalidTitle")}</h1>
            <p className="text-muted-foreground">{t("reset.linkInvalidBody")}</p>
          </div>
          <Button asChild className="w-full" size="lg">
            <Link to="/auth/reset">{t("reset.requestNewLink")}</Link>
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            <Link to="/auth/login" className="text-primary hover:underline font-medium">
              {t("reset.backToSignIn")}
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      {seo}
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">{t("reset.confirmTitle")}</h1>
          <p className="text-muted-foreground mt-2">{t("reset.confirmSubtitle", { email: user.email })}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="new-password">{t("reset.newPassword")}</Label>
            <div className="relative">
              <Lock className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="new-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder={t("passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="ps-10 pe-10"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{t("reset.requirement", { count: MIN_PASSWORD_LENGTH })}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">{t("reset.confirmPassword")}</Label>
            <div className="relative">
              <Lock className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="confirm-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder={t("passwordPlaceholder")}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                className="ps-10"
                required
              />
            </div>
          </div>

          <Button type="submit" className="w-full" size="lg" disabled={isSaving}>
            {isSaving ? t("reset.saving") : t("reset.save")}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default ResetPasswordConfirm;
