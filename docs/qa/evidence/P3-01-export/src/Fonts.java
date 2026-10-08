package exp;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;

/** jar 리소스(fonts/)에 넣은 글꼴을 읽는다. 시스템 글꼴은 쓰지 않는다. */
public final class Fonts {
	public static byte[] bytes(String file) {
		try (InputStream in = Fonts.class.getResourceAsStream("/fonts/" + file)) {
			if (in == null) throw new IllegalStateException("글꼴 리소스 없음: " + file);
			return in.readAllBytes();
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		}
	}

	private Fonts() {}
}
