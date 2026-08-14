import MapKit
import SwiftUI

/// Where the country is, shown the way a person would show it: the globe,
/// then the approach.
///
/// The camera starts in orbit and flies down to the country, and the country
/// itself is traced as a layer — the outline is the answer to "which one of
/// these is it", which a pin cannot say about a shape. The map takes no
/// touches: it is an illustration here, not a navigation surface, and a
/// scrolling sheet must not fight a panning map.
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
            ForEach(Array(outline.rings.enumerated()), id: \.offset) { _, ring in
                MapPolygon(coordinates: ring)
                    .stroke(.white, lineWidth: 2)
                    .foregroundStyle(Color.accentColor.opacity(0.25))
            }
        }
        .mapStyle(.hybrid(elevation: .realistic))
        .task {
            let region = MapCameraPosition.region(
                MKCoordinateRegion(
                    center: outline.center,
                    span: MKCoordinateSpan(
                        latitudeDelta: outline.latitudeDelta,
                        longitudeDelta: outline.longitudeDelta
                    )
                )
            )
            // Reduce Motion gets the destination without the flight.
            guard !reduceMotion else {
                position = region
                return
            }
            // A beat in orbit first: a fly-in that starts before the sheet has
            // finished arriving reads as a glitch rather than as a descent.
            try? await Task.sleep(for: .milliseconds(400))
            withAnimation(.smooth(duration: 2.4)) {
                position = region
            }
        }
    }

    /// Far enough that the whole planet is in frame.
    private static let orbitDistance: Double = 25_000_000
}
