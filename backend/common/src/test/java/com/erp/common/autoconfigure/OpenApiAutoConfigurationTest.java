package com.erp.common.autoconfigure;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.Paths;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.responses.ApiResponses;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import org.junit.jupiter.api.Test;

class OpenApiAutoConfigurationTest {

	@Test
	void 보안이_걸린_operation에만_401을_붙이고_공통_요소를_넣는다() {
		Operation secured = new Operation().security(List.of(new SecurityRequirement().addList("accessTokenCookie")))
			.responses(new ApiResponses().addApiResponse("200", new ApiResponse()));
		Operation open = new Operation().responses(new ApiResponses().addApiResponse("200", new ApiResponse()));
		OpenAPI openApi = new OpenAPI().info(new Info().title("OpenAPI definition"))
			.paths(new Paths().addPathItem("/a", new PathItem().get(secured)).addPathItem("/b", new PathItem().get(open)));

		OpenApiAutoConfiguration.customize(openApi, "worklog-service API");

		assertThat(openApi.getInfo().getTitle()).isEqualTo("worklog-service API");
		assertThat(openApi.getServers()).singleElement().satisfies(s -> assertThat(s.getUrl()).isEqualTo("/"));
		assertThat(openApi.getComponents().getSchemas()).containsKey("Problem");
		assertThat(openApi.getComponents().getResponses()).containsKey("Unauthorized");
		assertThat(secured.getResponses().get("401").get$ref()).isEqualTo(OpenApiAutoConfiguration.UNAUTHORIZED_REF);
		assertThat(open.getResponses()).doesNotContainKey("401");
	}

}
