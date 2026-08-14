import MapKit
import SwiftUI

/// Where the country is, shown the way a person would show it: the globe,
/// then the approach.
///
/// The camera starts in orbit and flies down to the country, and the country
/// itself is traced as a layer — the outline is the answer to "which one of
/// these is it", which a pin cannot say about a shape. This small map takes no
/// touches of its own: it is an illustration, and a scrolling sheet must not
/// fight a panning map. Touching it opens the full one instead.
struct CountryMapView: View {
    let outline: CountryBoundaries.Outline

    @State private var position: MapCameraPosition
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(outline: CountryBoundaries.Outline) {
        self.outline = outline
        // In orbit, over the country, so the fly-in is a descent rather than
        // a journey around the planet.
        _position = State(
            initialValue: .camera(
                MapCamera(centerCoordinate: outline.center, distance: Self.orbitDistance)
            )
        )
    }

    var body: some View {
        Map(position: $position, interactionModes: []) {
            CountryOutlineLayer(outline: outline)
        }
        .mapStyle(.hybrid(elevation: .realistic))
        .overlay(alignment: .bottomTrailing) {
            // The one hint that this picture goes somewhere.
            Image(systemName: "arrow.down.backward.and.arrow.up.forward")
                .font(DesignTokens.Typography.caption.weight(.semibold))
                .foregroundStyle(.white)
                .frame(
                    width: DesignTokens.Layout.minimumTouchTarget * 0.7,
                    height: DesignTokens.Layout.minimumTouchTarget * 0.7
                )
                .background(.ultraThinMaterial, in: Circle())
                .padding(DesignTokens.Spacing.small)
        }
        .task {
            // Reduce Motion gets the destination without the flight.
            guard !reduceMotion else {
                position = .region(outline.fittedRegion)
                return
            }
            // A beat in orbit first: a fly-in that starts before the sheet has
            // finished arriving reads as a glitch rather than as a descent.
            try? await Task.sleep(for: .milliseconds(400))
            withAnimation(.smooth(duration: 2.4)) {
                position = .region(outline.fittedRegion)
            }
        }
    }

    /// Far enough that the whole planet is in frame.
    private static let orbitDistance: Double = 25_000_000
}

/// The map as a place rather than a picture: full screen, free to pan, spin
/// and tilt. The outline stays — it is what the reader came to look at.
struct CountryMapExpandedView: View {
    let name: String
    let outline: CountryBoundaries.Outline

    @State private var position: MapCameraPosition
    @Environment(\.dismiss) private var dismiss

    init(name: String, outline: CountryBoundaries.Outline) {
        self.name = name
        self.outline = outline
        _position = State(initialValue: .region(outline.fittedRegion))
    }

    var body: some View {
        Map(position: $position) {
            CountryOutlineLayer(outline: outline)
        }
        .mapStyle(.hybrid(elevation: .realistic))
        .ignoresSafeArea()
        .overlay(alignment: .top) {
            HStack {
                Text(name)
                    .font(DesignTokens.Typography.caption.weight(.medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, DesignTokens.Spacing.medium)
                    .frame(minHeight: DesignTokens.Layout.minimumTouchTarget * 0.75)
                    .background(.ultraThinMaterial, in: Capsule())

                Spacer()

                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(DesignTokens.Typography.caption.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(
                            width: DesignTokens.Layout.minimumTouchTarget,
                            height: DesignTokens.Layout.minimumTouchTarget
                        )
                        .background(.ultraThinMaterial, in: Circle())
                }
                .accessibilityLabel(L10n.studyClose)
                .accessibilityIdentifier(AccessibilityIdentifier.studyClose)
            }
            .padding(DesignTokens.Spacing.medium)
        }
    }
}

/// The traced country, shared by both maps so they cannot drift apart.
private struct CountryOutlineLayer: MapContent {
    let outline: CountryBoundaries.Outline

    var body: some MapContent {
        ForEach(Array(outline.rings.enumerated()), id: \.offset) { _, ring in
            MapPolygon(coordinates: ring)
                .stroke(.white, lineWidth: 2)
                .foregroundStyle(Color.accentColor.opacity(0.25))
        }
    }
}

extension CountryBoundaries.Outline {
    /// The region that frames every ring.
    var fittedRegion: MKCoordinateRegion {
        MKCoordinateRegion(
            center: center,
            span: MKCoordinateSpan(
                latitudeDelta: latitudeDelta,
                longitudeDelta: longitudeDelta
            )
        )
    }
}
