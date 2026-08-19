from __future__ import annotations

from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class ContractBuildHook(BuildHookInterface):
    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        repository_contract = (
            Path(self.root).parent / "apps" / "automation-service-browserbase" / "openapi.yaml"
        )
        bundled_contract = (
            Path(self.root) / "apps" / "automation-service-browserbase" / "openapi.yaml"
        )

        if self.target_name == "sdist":
            build_data["force_include"][str(repository_contract)] = (
                "apps/automation-service-browserbase/openapi.yaml"
            )
            return

        contract = repository_contract if repository_contract.is_file() else bundled_contract
        build_data["force_include"][str(contract)] = "relay_backend/automation_service_openapi.yaml"
