import { alpha } from "@mui/material/styles";
import type { SxProps, Theme } from "@mui/material/styles";
import type { RaThemeOptions } from "react-admin";
import type { AdminEnvironment } from "../config/runtime-config";

/**
 * The console's design decision record (#201): palette, typography, shape,
 * density and component form for both themes are decided here and nowhere
 * else. Screens compose these primitives; they do not restyle them.
 *
 * The product itself is a dark scene lit by flag colors (ADR-012). The
 * console borrows that identity where it can carry it — the ink app bar,
 * the login scene, the glow behind the dark theme — while staying a
 * daylight working tool: a calm, neutral chrome that lets flag artwork
 * provide the color.
 */

const FONT_STACK = [
  "-apple-system",
  "BlinkMacSystemFont",
  '"SF Pro Text"',
  '"Segoe UI"',
  "Roboto",
  '"Helvetica Neue"',
  "Arial",
  "sans-serif",
].join(", ");

/** Small-caps labels: table heads, tile captions, sidebar sections. */
const OVERLINE = {
  fontSize: "0.6875rem",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  lineHeight: 1.5,
};

interface ModeTokens {
  mode: "light" | "dark";
  accent: string;
  accentStrong: string;
  accentSoft: string;
  onAccent: string;
  bgDefault: string;
  bgPaper: string;
  textPrimary: string;
  textSecondary: string;
  divider: string;
  cardBorder: string;
  cardShadow: string;
  tableHeadDivider: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  /** The navigation column: deep navy in both themes (docs/19 §10). */
  navSurface: string;
  navText: string;
  navTextMuted: string;
  navActiveText: string;
  navActiveSurface: string;
  navBorder: string;
  /** Radial flag-light behind the dark scene; light theme has none. */
  sceneGlow?: string;
}

const LIGHT: ModeTokens = {
  mode: "light",
  accent: "#2A5BD7",
  accentStrong: "#1E44A6",
  accentSoft: "#6C8FE8",
  onAccent: "#FFFFFF",
  bgDefault: "#F3F5F9",
  bgPaper: "#FFFFFF",
  textPrimary: "#16202E",
  textSecondary: "#56677D",
  divider: "rgba(22, 32, 46, 0.12)",
  cardBorder: "rgba(22, 32, 46, 0.10)",
  cardShadow: "0 1px 2px rgba(22, 32, 46, 0.06)",
  tableHeadDivider: "rgba(22, 32, 46, 0.18)",
  success: "#1B7F4D",
  warning: "#B26A00",
  error: "#B3261E",
  info: "#0E7490",
  navSurface: "#16202E",
  navText: "rgba(233, 238, 247, 0.82)",
  navTextMuted: "rgba(233, 238, 247, 0.58)",
  navActiveText: "#FFFFFF",
  navActiveSurface: "rgba(108, 143, 232, 0.24)",
  navBorder: "rgba(233, 238, 247, 0.12)",
};

const DARK: ModeTokens = {
  mode: "dark",
  accent: "#86A8FF",
  accentStrong: "#5B82E3",
  accentSoft: "#A9C1FF",
  onAccent: "#0C1420",
  bgDefault: "#0C1420",
  bgPaper: "#121D2E",
  textPrimary: "#E9EEF7",
  textSecondary: "#9AA9BF",
  divider: "rgba(151, 180, 255, 0.14)",
  cardBorder: "rgba(151, 180, 255, 0.12)",
  cardShadow: "none",
  tableHeadDivider: "rgba(151, 180, 255, 0.22)",
  success: "#43C583",
  warning: "#E3A63C",
  error: "#F0655A",
  info: "#56BCD1",
  navSurface: "rgba(10, 17, 32, 0.72)",
  navText: "rgba(233, 238, 247, 0.80)",
  navTextMuted: "rgba(233, 238, 247, 0.55)",
  navActiveText: "#FFFFFF",
  navActiveSurface: "rgba(134, 168, 255, 0.20)",
  navBorder: "rgba(151, 180, 255, 0.14)",
  sceneGlow:
    "radial-gradient(60rem 40rem at 85% -10%, rgba(58, 108, 255, 0.16), transparent 60%), " +
    "radial-gradient(50rem 36rem at -10% 110%, rgba(255, 180, 64, 0.07), transparent 60%)",
};

function buildTheme(t: ModeTokens): RaThemeOptions {
  return {
    palette: {
      mode: t.mode,
      primary: {
        main: t.accent,
        dark: t.accentStrong,
        light: t.accentSoft,
        contrastText: t.onAccent,
      },
      secondary: { main: t.textSecondary },
      success: { main: t.success },
      warning: { main: t.warning },
      error: { main: t.error },
      info: { main: t.info },
      background: { default: t.bgDefault, paper: t.bgPaper },
      text: { primary: t.textPrimary, secondary: t.textSecondary },
      divider: t.divider,
    },
    typography: {
      fontFamily: FONT_STACK,
      h4: { fontSize: "1.625rem", fontWeight: 800, letterSpacing: "-0.015em" },
      h5: { fontSize: "1.25rem", fontWeight: 700, letterSpacing: "-0.01em" },
      h6: { fontSize: "1.0625rem", fontWeight: 700 },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      overline: OVERLINE,
      button: { textTransform: "none", fontWeight: 600 },
    },
    shape: { borderRadius: 10 },
    sidebar: { width: 244, closedWidth: 56 },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: t.bgDefault,
            ...(t.sceneGlow === undefined
              ? {}
              : {
                  backgroundImage: t.sceneGlow,
                  backgroundAttachment: "fixed",
                }),
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { backgroundImage: "none" } },
      },
      MuiAppBar: { defaultProps: { elevation: 0 } },
      MuiCard: {
        styleOverrides: {
          root: {
            border: `1px solid ${t.cardBorder}`,
            borderRadius: 14,
            boxShadow: t.cardShadow,
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { borderRadius: 9 } },
      },
      MuiButtonBase: {
        styleOverrides: {
          root: {
            "&.Mui-focusVisible": {
              outline: `2px solid ${t.accent}`,
              outlineOffset: 2,
            },
          },
        },
      },
      MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: 10 } } },
      MuiTextField: { defaultProps: { size: "small" } },
      MuiTableCell: {
        styleOverrides: {
          head: {
            ...OVERLINE,
            color: t.textSecondary,
            borderBottom: `1px solid ${t.tableHeadDivider}`,
            whiteSpace: "nowrap",
          },
        },
      },
      RaDatagrid: {
        styleOverrides: {
          root: {
            "& .RaDatagrid-headerCell": {
              ...OVERLINE,
              color: t.textSecondary,
              backgroundColor: "transparent",
              borderBottom: `1px solid ${t.tableHeadDivider}`,
            },
            "& .RaDatagrid-rowCell": { paddingTop: 10, paddingBottom: 10 },
          },
        },
      },
      RaLayout: {
        styleOverrides: {
          root: {
            backgroundColor: "transparent",
            "& .RaLayout-content": {
              paddingLeft: 24,
              paddingRight: 24,
              paddingBottom: 32,
            },
          },
        },
      },
      // The navigation column is chrome, not canvas (docs/19 §10): deep
      // navy in both themes, so `Published content` and `Draft workspace`
      // read as one structure rather than as two panels of the page.
      RaSidebar: {
        styleOverrides: {
          root: {
            "& .RaSidebar-fixed": {
              backgroundColor: t.navSurface,
              borderRight: `1px solid ${t.navBorder}`,
              ...(t.mode === "light" ? {} : { backdropFilter: "blur(14px)" }),
            },
          },
        },
      },
      RaMenuItemLink: {
        styleOverrides: {
          root: {
            borderRadius: 9,
            marginInline: 8,
            marginBlock: 2,
            paddingBlock: 8,
            color: t.navText,
            "& .RaMenuItemLink-icon": { minWidth: 34, color: "inherit" },
            "&:hover": {
              backgroundColor: alpha(t.accentSoft, 0.12),
              color: t.navActiveText,
            },
            "&.RaMenuItemLink-active": {
              color: t.navActiveText,
              backgroundColor: t.navActiveSurface,
              fontWeight: 700,
            },
          },
        },
      },
      RaLabeled: {
        styleOverrides: {
          root: {
            "& .RaLabeled-label": {
              ...OVERLINE,
              fontSize: "0.625rem",
              color: t.textSecondary,
            },
          },
        },
      },
    },
  };
}

export const lightTheme = buildTheme(LIGHT);
export const darkTheme = buildTheme(DARK);

/**
 * The group labels down the navigation column.
 *
 * They sit on the navy chrome rather than on the page, so their colour
 * comes from the navigation tokens instead of `text.secondary`, which is
 * ink on white and would vanish there.
 */
export const menuSectionSx: SxProps<Theme> = (theme: Theme) => ({
  display: "block",
  px: 2.5,
  pt: 2,
  pb: 0.5,
  fontSize: "0.625rem",
  color:
    theme.palette.mode === "light" ? LIGHT.navTextMuted : DARK.navTextMuted,
});

// --- The product scene -----------------------------------------------------
// The dark stage the app itself lives on (ADR-012). The console uses it for
// the surfaces that exist outside a theme choice: the login and the crash
// screen.

export const scene = {
  ink: "#0A1120",
  text: "#E9EEF7",
  textDim: "#9AA9BF",
  glass: "rgba(15, 25, 43, 0.68)",
  glassBorder: "rgba(151, 180, 255, 0.20)",
  crimson: "#B3261E",
};

/** The scene's radial lights; prod trades the cobalt glow for a red one. */
export function sceneBackgroundImage(environment: AdminEnvironment): string {
  const primaryGlow =
    environment === "prod"
      ? "rgba(179, 38, 30, 0.42)"
      : "rgba(58, 108, 255, 0.36)";
  return (
    `radial-gradient(48rem 34rem at 78% 6%, ${primaryGlow}, transparent 62%), ` +
    "radial-gradient(42rem 30rem at 10% 94%, rgba(255, 180, 64, 0.14), transparent 60%)"
  );
}

// --- Environment treatment -------------------------------------------------
// Safety affordances are part of the design system (#201, ADR-014): the
// badge and the app bar always disclose the environment, and prod is
// unmistakable in either theme.

interface EnvChipStyle {
  background: string;
  color: string;
  border?: string;
}

export const ENV_CHIP: Record<AdminEnvironment, EnvChipStyle> = {
  local: {
    background: "transparent",
    color: "inherit",
    border: "1px solid currentColor",
  },
  dev: { background: "#2456D6", color: "#FFFFFF" },
  // White on the crimson prod bar: the loudest thing on the screen.
  prod: { background: "#FFFFFF", color: "#8F1D18" },
};

export const ENV_DOT: Record<AdminEnvironment, string> = {
  local: "#8A97A8",
  dev: "#2456D6",
  prod: "#B3261E",
};

export function appBarSx(environment: AdminEnvironment): SxProps<Theme> {
  if (environment === "prod") {
    return {
      color: "#FFFFFF",
      backgroundColor: "#8F1D18",
      backgroundImage: "linear-gradient(90deg, #7A1712, #A62A22)",
      borderBottom: "1px solid rgba(255, 255, 255, 0.28)",
    };
  }
  // Dev and local wear the product's ink; the light theme keeps it as its
  // one dark surface so the console still reads as Country Flags.
  return (theme: Theme) => ({
    color:
      theme.palette.mode === "light" ? "#E9EEF7" : theme.palette.text.primary,
    backgroundColor:
      theme.palette.mode === "light" ? "#16202E" : "rgba(13, 21, 36, 0.85)",
    backdropFilter: "blur(14px)",
    borderBottom: `1px solid ${
      theme.palette.mode === "light"
        ? "rgba(233, 238, 247, 0.14)"
        : theme.palette.divider
    }`,
  });
}
