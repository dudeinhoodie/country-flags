import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { useAdminApiClient } from "../api/ApiClientContext";
import { BrandMark } from "../components/BrandMark";
import { EnvironmentBadge } from "../components/EnvironmentBadge";
import { useRuntimeConfig } from "../config/RuntimeConfigContext";
import { scene, sceneBackgroundImage } from "./theme";

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleIdApi {
  initialize(options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: { theme: string; size: string },
  ): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const GIS_SCRIPT_ID = "google-identity-services";

function loadGoogleIdentity(): Promise<GoogleIdApi> {
  return new Promise((resolvePromise, rejectPromise) => {
    const existing = window.google?.accounts.id;
    if (existing !== undefined) {
      resolvePromise(existing);
      return;
    }
    let script = document.getElementById(
      GIS_SCRIPT_ID,
    ) as HTMLScriptElement | null;
    if (script === null) {
      script = document.createElement("script");
      script.id = GIS_SCRIPT_ID;
      script.src = GIS_SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => {
      const api = window.google?.accounts.id;
      if (api !== undefined) {
        resolvePromise(api);
      } else {
        rejectPromise(new Error("Google Identity Services did not initialise"));
      }
    });
    script.addEventListener("error", () => {
      rejectPromise(new Error("Google Identity Services failed to load"));
    });
  });
}

/**
 * The only way in: a Google ID token handed to the backend, which answers
 * with an HttpOnly session cookie. No token ever touches localStorage.
 */
export function LoginPage() {
  const config = useRuntimeConfig();
  const client = useAdminApiClient();
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (config.googleClientId === "") {
      return;
    }
    let cancelled = false;

    async function signIn(credential: string | undefined): Promise<void> {
      if (credential === undefined) {
        setError("Google returned no credential");
        return;
      }
      const {
        data,
        response,
        error: apiError,
      } = await client.POST("/v1/admin/auth/google", {
        body: { idToken: credential },
      });
      if (data === undefined) {
        const envelope = apiError as
          | { error?: { message?: string } }
          | undefined;
        setError(
          envelope?.error?.message ??
            `Sign-in failed with HTTP ${String(response.status)}`,
        );
        return;
      }
      // The session cookie is set; a reload restarts react-admin from an
      // authenticated state.
      window.location.assign("#/");
      window.location.reload();
    }

    loadGoogleIdentity().then(
      (api) => {
        if (cancelled || buttonRef.current === null) {
          return;
        }
        api.initialize({
          client_id: config.googleClientId,
          callback: (response) => {
            void signIn(response.credential);
          },
        });
        api.renderButton(buttonRef.current, {
          theme: "outline",
          size: "large",
        });
      },
      (loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load Google sign-in",
          );
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [config, client]);

  // The login is a brand surface: the product's dark scene regardless of
  // the console theme, with the glow turning red when this is prod.
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 3,
        color: scene.text,
        backgroundColor: scene.ink,
        backgroundImage: sceneBackgroundImage(config.environment),
      }}
    >
      <Stack spacing={4} sx={{ alignItems: "center" }}>
        <Stack spacing={1.5} sx={{ alignItems: "center" }}>
          <BrandMark size={48} />
          <Stack spacing={0.25} sx={{ alignItems: "center" }}>
            <Typography
              variant="h5"
              component="h1"
              sx={{ fontWeight: 800, letterSpacing: "-0.01em" }}
            >
              Country Flags Admin
            </Typography>
            <Typography variant="overline" sx={{ color: scene.textDim }}>
              Catalog console
            </Typography>
          </Stack>
        </Stack>
        <Card
          sx={{
            width: "min(400px, 92vw)",
            backgroundColor: scene.glass,
            border: `1px solid ${scene.glassBorder}`,
            borderRadius: 4,
            backdropFilter: "blur(18px)",
            boxShadow: "0 24px 60px rgba(4, 9, 20, 0.55)",
          }}
        >
          <CardContent sx={{ p: 4 }}>
            <Stack spacing={2.5} sx={{ alignItems: "center" }}>
              <EnvironmentBadge />
              <Typography
                variant="body2"
                sx={{ color: scene.textDim, textAlign: "center" }}
              >
                Sign in with your Google account. Access is granted by an
                administrator.
              </Typography>
              {config.googleClientId === "" ? (
                <Alert severity="warning">
                  Google sign-in is not configured for this environment: the
                  runtime config has an empty googleClientId.
                </Alert>
              ) : (
                <div ref={buttonRef} />
              )}
              {error !== null && <Alert severity="error">{error}</Alert>}
            </Stack>
          </CardContent>
        </Card>
        <Typography variant="caption" sx={{ color: scene.textDim }}>
          Build {config.appVersion}
        </Typography>
      </Stack>
    </Box>
  );
}
