import SwiftUI

/// Минимальный набор design tokens.
///
/// Экраны не задают отступы и радиусы числами: значения приходят отсюда, чтобы
/// последующие задачи меняли шкалу в одном месте. Типографика опирается на
/// системные текстовые стили и поэтому поддерживает Dynamic Type без
/// дополнительной работы.
public enum DesignTokens {
    public enum Spacing {
        public static let extraSmall: CGFloat = 4
        public static let small: CGFloat = 8
        public static let medium: CGFloat = 16
        public static let large: CGFloat = 24
        public static let extraLarge: CGFloat = 32
    }

    public enum Radius {
        public static let small: CGFloat = 8
        public static let medium: CGFloat = 12
    }

    public enum Layout {
        /// Минимальная сторона интерактивного элемента по рекомендациям
        /// платформы.
        public static let minimumTouchTarget: CGFloat = 44
        public static let maximumContentWidth: CGFloat = 520
    }

    public enum Typography {
        public static let screenTitle: Font = .largeTitle.weight(.bold)
        public static let sectionTitle: Font = .headline
        public static let body: Font = .body
        public static let caption: Font = .footnote
    }
}
