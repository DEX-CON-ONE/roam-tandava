import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { SEOHead } from "@/components/seo/SEOHead";
import { Mail, MailCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Step 1 of password reset: ask for the account email and send the reset link. */
const ResetPassword = () => {
  const { toast } = useToast();
  const { resetPassword } = useAuth();
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Honeypot guard: bots tend to fill hidden fields.
    if (honeypot.trim()) return;

    setIsLoading(true);
    const { error } = await resetPassword(email.trim());
    setIsLoading(false);

    if (error) {
      toast({ title: t("reset.requestFailed"), description: error.message, variant: "destructive" });
      return;
    }
    // Same confirmation whether or not the address has an account.
    setSent(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <SEOHead title="Reset Password" description="Reset the password for your account." canonical="/auth/reset" noindex />
      <div className="w-full max-w-md space-y-8">
        {sent ? (
          <div className="space-y-6 text-center">
            <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
              <MailCheck className="h-10 w-10 text-primary" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight">{t("reset.sentTitle")}</h1>
              <p className="text-muted-foreground">{t("reset.sentBody", { email: email.trim() })}</p>
            </div>
            <Button asChild className="w-full" size="lg">
              <Link to="/auth/login">{t("reset.backToSignIn")}</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-tight">{t("reset.requestTitle")}</h1>
              <p className="text-muted-foreground mt-2">{t("reset.requestSubtitle")}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                className="hidden"
                aria-hidden="true"
              />
              <div className="space-y-2">
                <Label htmlFor="email">{t("email")}</Label>
                <div className="relative">
                  <Mail className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder={t("emailPlaceholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="ps-10"
                    required
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
                {isLoading ? t("reset.sending") : t("reset.sendLink")}
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground">
              <Link to="/auth/login" className="text-primary hover:underline font-medium">
                {t("reset.backToSignIn")}
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
