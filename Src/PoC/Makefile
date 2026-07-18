.PHONY: test coverage demo accuracy

test:
	PYTHONPATH=src python3 -m unittest discover -s tests -v

coverage:
	PYTHONPATH=src python3 -m coverage run --source=src/code_guardian -m unittest discover -s tests
	python3 -m coverage report -m

demo:
	PYTHONPATH=src python3 -m code_guardian.cli owasp --repo examples/sample_repo --provider ollama

accuracy:
	python3 scripts/measure_accuracy.py --provider $(PROVIDER)
