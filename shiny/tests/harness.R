# A tiny test harness in base R, so the R images need no extra packages (the Shiny and preprocess images do not ship testthat).
# test("name", { expect(condition, "message"); ... }) runs the block and records a failure instead of stopping; finish() prints the
# summary and exits with status 1 if anything failed, which is what CI looks at.

.results <- new.env()
.results$passed <- 0L
.results$failed <- character()

# Fails the running test (by raising an error the test() wrapper catches) unless the condition is TRUE
expect <- function(condition, message = "expectation failed") {
  if (!isTRUE(condition)) {
    stop(message, call. = FALSE)
  }
  invisible(TRUE)
}

# Fails unless the two values are identical (all.equal for numbers, so rounding does not matter); shows both on failure
expect_equal <- function(actual, expected, message = NULL) {
  same <- if (is.numeric(actual) && is.numeric(expected)) {
    isTRUE(all.equal(as.numeric(actual), as.numeric(expected)))
  } else {
    identical(actual, expected)
  }
  if (!same) {
    stop(
      paste0(
        if (!is.null(message)) paste0(message, ": "),
        "expected ",
        paste(utils::capture.output(dput(expected)), collapse = " "),
        " but got ",
        paste(utils::capture.output(dput(actual)), collapse = " ")
      ),
      call. = FALSE
    )
  }
  invisible(TRUE)
}

# Fails unless evaluating the expression raises an error whose message matches the pattern
expect_error <- function(expr, pattern = "") {
  message <- tryCatch(
    {
      expr
      NULL
    },
    error = function(e) conditionMessage(e)
  )
  if (is.null(message)) {
    stop("expected an error but there was none", call. = FALSE)
  }
  if (!grepl(pattern, message)) {
    stop("the error \"", message, "\" does not match \"", pattern, "\"", call. = FALSE)
  }
  invisible(TRUE)
}

# Runs one test; an error inside is a failure and the next test still runs
test <- function(name, code) {
  outcome <- tryCatch(
    {
      force(code)
      NULL
    },
    error = function(e) conditionMessage(e)
  )
  if (is.null(outcome)) {
    .results$passed <- .results$passed + 1L
    cat("  ok    ", name, "\n", sep = "")
  } else {
    .results$failed <- c(.results$failed, name)
    cat("  FAIL  ", name, "\n        ", outcome, "\n", sep = "")
  }
}

# Prints the totals and ends the script with a non-zero status when a test failed
finish <- function() {
  cat(sprintf("\n%d passed, %d failed\n", .results$passed, length(.results$failed)))
  quit(status = if (length(.results$failed)) 1L else 0L)
}
